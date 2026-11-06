import { BadRequestException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { EmailVerificationDelivery, EmailVerificationService, VerificationResendLimiter, RESEND_ACCEPTED } from '../src/modules/auth/email-verification.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { UsersService } from '../src/modules/users/users.service';
import { validateEnvironment } from '../src/config/configuration';

const config = (extra: Record<string, unknown> = {}) => ({ get: (key: string) => ({
  NODE_ENV: 'development', EMAIL_VERIFICATION_DELIVERY: 'development-console',
  EMAIL_VERIFICATION_FRONTEND_URL: 'http://127.0.0.1:8513', ...extra,
}[key]) } as ConfigService);

describe('verification delivery and limits (isolated fixtures, not live)', () => {
  it('permits one concurrent send, three per rolling hour, with a 60 second cooldown', async () => {
    const limiter = new VerificationResendLimiter();
    expect(limiter.claim('unit@example.invalid', 0)).toBe(true);
    expect(limiter.claim('unit@example.invalid', 59999)).toBe(false);
    expect(limiter.claim('unit@example.invalid', 60000)).toBe(true);
    expect(limiter.claim('unit@example.invalid', 120000)).toBe(true);
    expect(limiter.claim('unit@example.invalid', 180000)).toBe(false);
    expect(limiter.claim('unit@example.invalid', 3600000)).toBe(true);
  });
  it.each([{}, {NODE_ENV:'production'}, {EMAIL_VERIFICATION_DELIVERY:'disabled'},
    {EMAIL_VERIFICATION_FRONTEND_URL:'https://untrusted.invalid'},
    {EMAIL_VERIFICATION_FRONTEND_URL:'http://127.0.0.1:8513/?token=not-allowed'}])('fails closed without a private development TTY/config: %j', async extra => {
    const write = jest.fn();
    const tty = Object.keys(extra).length !== 0;
    const delivery = new EmailVerificationDelivery(config(extra), {isTTY:tty,write});
    await expect(delivery.send('unit-only-token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(write).not.toHaveBeenCalled();
  });
  it('writes a fragment link only to the explicitly supplied interactive console', async () => {
    const writes: string[] = [];
    const delivery = new EmailVerificationDelivery(config(), {isTTY:true,write:(value, cb)=>{writes.push(value);cb();}});
    await delivery.send('fixture-only-verification');
    const line = writes[0].split('\n')[1];
    const link = new URL(line);
    expect(link.origin).toBe('http://127.0.0.1:8513');
    expect(link.search).toBe('');
    expect(link.hash).toBe('#verify-email=fixture-only-verification');
  });
  it('keeps console write failures sanitized', async () => {
    const delivery = new EmailVerificationDelivery(config(), {isTTY:true,write:(_, cb)=>cb(new Error('do not expose provider content'))});
    await expect(delivery.send('fixture-only')).rejects.toThrow('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE');
  });
  it.each([null, {status:'active',email_verified_at:new Date(),role_count:1,role:'USER'},
    {status:'disabled',email_verified_at:null,role_count:1,role:'USER'},
    {status:'active',email_verified_at:null,role_count:1,role:'ADMIN'},
    {status:'active',email_verified_at:null,role_count:2,role:'USER'}])('returns the same accepted DTO for ineligible accounts', async account => {
    const repo={findEmailVerificationAccount:jest.fn().mockResolvedValue(account)};
    const delivery={assertReady:jest.fn(),send:jest.fn()};const issue=jest.fn();
    const service=new EmailVerificationService(repo as unknown as AuthRepository,delivery as unknown as EmailVerificationDelivery,new VerificationResendLimiter());
    expect(await service.resend(' UNIT@example.invalid ',issue)).toEqual(RESEND_ACCEPTED);
    expect(repo.findEmailVerificationAccount).toHaveBeenCalledWith('unit@example.invalid');
    expect(issue).not.toHaveBeenCalled();expect(delivery.send).not.toHaveBeenCalled();
  });
  it('coalesces concurrent resends before database/delivery awaits', async () => {
    const repo={findEmailVerificationAccount:jest.fn().mockResolvedValue({id:'2',status:'active',email_verified_at:null,role_count:1,role:'USER'})};
    const delivery={assertReady:jest.fn(),send:jest.fn().mockResolvedValue(undefined)};
    const issue=jest.fn().mockResolvedValue('fixture-only');
    const service=new EmailVerificationService(repo as unknown as AuthRepository,delivery as unknown as EmailVerificationDelivery,new VerificationResendLimiter());
    const responses=await Promise.all(Array.from({length:10},()=>service.resend('unit@example.invalid',issue)));
    expect(responses.every(r=>JSON.stringify(r)===JSON.stringify(RESEND_ACCEPTED))).toBe(true);
    expect(issue).toHaveBeenCalledTimes(1);expect(delivery.send).toHaveBeenCalledTimes(1);
  });
  it('checks channel availability before disclosing account eligibility', async () => {
    const repo={findEmailVerificationAccount:jest.fn()};
    const service=new EmailVerificationService(repo as unknown as AuthRepository,new EmailVerificationDelivery(config(),{isTTY:false,write:jest.fn()}),new VerificationResendLimiter());
    await expect(service.resend('unit@example.invalid',jest.fn())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.findEmailVerificationAccount).not.toHaveBeenCalled();
  });
});

describe('existing verification token contract', () => {
  const key='isolated-unit-key-'.repeat(3);const jwt=new JwtService();
  const cfg={getOrThrow:()=>key} as unknown as ConfigService;
  it('reuses issuer, audience, purpose and 900-second TTL for resend', async () => {
    let issued='';const resend={resend:async(_:string,issue:(id:string)=>Promise<string>)=>{issued=await issue('2');return RESEND_ACCEPTED;}};
    const service=new AuthService({} as AuthRepository,{} as UsersService,jwt,cfg,resend as EmailVerificationService);
    expect(await service.resendVerification('unit@example.invalid')).toEqual(RESEND_ACCEPTED);
    const data=await jwt.verifyAsync(issued,{secret:key,issuer:'aiva-iot',audience:'aiva-email-verification'});
    expect(data).toMatchObject({sub:'2',typ:'email_verification'});expect(data.exp-data.iat).toBe(900);
  });
  it.each(['expired','wrong-purpose','wrong-audience'])('does not update verification for %s', async kind => {
    const repo={verifyEmail:jest.fn()};
    const service=new AuthService(repo as unknown as AuthRepository,{} as UsersService,jwt,cfg);
    const token=await jwt.signAsync({sub:'2',typ:kind==='wrong-purpose'?'access':'email_verification'},
      {secret:key,issuer:'aiva-iot',audience:kind==='wrong-audience'?'aiva-api':'aiva-email-verification',expiresIn:kind==='expired'?-1:900});
    await expect(service.verifyEmail(token)).rejects.toBeInstanceOf(BadRequestException);expect(repo.verifyEmail).not.toHaveBeenCalled();
  });
  it('uses the existing repository verification only after valid verification JWT', async () => {
    const repo={verifyEmail:jest.fn().mockResolvedValue(true)};
    const service=new AuthService(repo as unknown as AuthRepository,{} as UsersService,jwt,cfg);
    const token=await jwt.signAsync({sub:'2',typ:'email_verification'},{secret:key,issuer:'aiva-iot',audience:'aiva-email-verification',expiresIn:900});
    expect(await service.verifyEmail(token)).toEqual({success:true});expect(repo.verifyEmail).toHaveBeenCalledWith('2');
  });
});

describe('resend HTTP DTO and IP throttle (fixture service)', () => {
  let app: any;const resend=jest.fn().mockResolvedValue(RESEND_ACCEPTED);
  beforeAll(async()=>{const m=await Test.createTestingModule({imports:[ThrottlerModule.forRoot([{name:'default',ttl:60000,limit:100}])],controllers:[AuthController],providers:[{provide:AuthService,useValue:{resendVerification:resend}},{provide:APP_GUARD,useClass:ThrottlerGuard}]}).compile();app=m.createNestApplication();app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();});
  afterAll(async()=>app.close());
  it('rejects unknown fields then limits the endpoint to five requests per IP per minute',async()=>{
    await request(app.getHttpServer()).post('/auth/resend-verification').send({email:'unit@example.invalid',role:'ADMIN'}).expect(400);
    for(let i=0;i<4;i++)await request(app.getHttpServer()).post('/auth/resend-verification').send({email:'unit@example.invalid'}).expect(202).expect(({body})=>expect(body).toEqual(RESEND_ACCEPTED));
    await request(app.getHttpServer()).post('/auth/resend-verification').send({email:'unit@example.invalid'}).expect(429);
    expect(resend).toHaveBeenCalledTimes(4);
  });
});


describe('verification configuration', () => {
  const valid = {DB_HOST:'127.0.0.1',DB_PORT:'3306',DB_USER:'unit',DB_PASSWORD:'unit-only',DB_NAME:'aiva_iot',
    JWT_ACCESS_SECRET:'a'.repeat(40),JWT_REFRESH_SECRET:'b'.repeat(40),APP_ENCRYPTION_KEY:'c'.repeat(43),
    ADMIN_EMAIL:'unit@example.invalid',ADMIN_PASSWORD:'unit-only',ADMIN_DISPLAY_NAME:'Unit'};
  it('requires explicit development and a trusted loopback origin for console delivery',()=>{
    expect(()=>validateEnvironment({...valid,NODE_ENV:'production',EMAIL_VERIFICATION_DELIVERY:'development-console'})).toThrow('development');
    expect(()=>validateEnvironment({...valid,NODE_ENV:'development',EMAIL_VERIFICATION_DELIVERY:'development-console',EMAIL_VERIFICATION_FRONTEND_URL:'https://untrusted.invalid'})).toThrow('loopback');
    expect(()=>validateEnvironment({...valid,NODE_ENV:'development',EMAIL_VERIFICATION_DELIVERY:'development-console',EMAIL_VERIFICATION_FRONTEND_URL:'http://127.0.0.1:8513'})).not.toThrow();
  });
});
