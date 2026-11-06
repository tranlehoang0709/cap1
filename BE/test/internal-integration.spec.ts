/** Real AppModule + TCP HTTP + real guards/services; repositories are transaction
 * models. These tests do NOT prove MySQL behavior or live Cloud execution. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MYSQL_POOL } from '../src/database/database.constants';
import { AdminSeeder } from '../src/modules/auth/admin-seeder.service';
import { OwnershipRepository } from '../src/modules/devices/ownership.repository';
import { AiProvidersRepository } from '../src/modules/ai-providers/ai-providers.repository';
import { QuotasRepository } from '../src/modules/quotas/quotas.repository';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

const tokens={device:'d'.repeat(43),config:'c'.repeat(43),quota:'q'.repeat(43)};
const credential='p'.repeat(43),jwtKey='test-only-internal-jwt-signing-key-32bytes';
const date=new Date('2026-11-03T01:00:00Z');
const profile=(user:string)=>({assistantName:`robot-${user}`,systemPrompt:`profile-${user}`,preferredProviderId:'2',preferredLlmModelId:'3',languageCode:'vi',voiceCode:`voice-${user}`});

describe('Full AppModule internal integration (mock repositories)',()=>{
  let app:INestApplication,base:string,records:any[],now:Date,revoked:boolean,expired:boolean,disabled:boolean,schema:boolean;
  let tx:any,ai:any,ownership:any;
  const saved:Record<string,string|undefined>={};
  const env:Record<string,string>={NODE_ENV:'test',DB_HOST:'not-a-real-database.invalid',DB_PORT:'3306',DB_USER:'fixture',DB_PASSWORD:'fixture',DB_NAME:'aiva_iot',
    JWT_ACCESS_SECRET:jwtKey,JWT_REFRESH_SECRET:'r'.repeat(43),APP_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64url'),
    ADMIN_EMAIL:'fixture@example.invalid',ADMIN_PASSWORD:'fixture-only-password',ADMIN_DISPLAY_NAME:'Fixture',
    AI_DEVICE_SERVICE_TOKEN:tokens.device,AI_CONFIG_SERVICE_TOKEN:tokens.config,AI_QUOTA_SERVICE_TOKEN:tokens.quota,
    DEVICE_AUTH_CONTRACT_APPROVED:'true',AI_CONFIG_CONTRACT_APPROVED:'true',AI_QUOTA_CONTRACT_APPROVED:'true',
    AI_USAGE_REPORT_TIMEOUT_SECONDS:'30',AI_USAGE_REPORT_SWEEPER_ENABLED:'false'};
  const user=(id:string)=>({id,email:'fixture@example.invalid',display_name:'Fixture',status:disabled?'disabled':'active',email_verified_at:date});
  const clone=(v:any)=>structuredClone(v);
  beforeAll(async()=>{
    for(const name of [...Object.keys(env),'ADMIN_ACCESS_JWT_SECRET','ADMIN_ACCESS_JWT_ISSUER','ADMIN_ACCESS_JWT_AUDIENCE']){saved[name]=process.env[name];delete process.env[name];}
    Object.assign(process.env,env);
    const {AppModule}=await import('../src/app.module');
    const users={findByIdForUpdate:jest.fn(async(id:string)=>user(id)),findUserRoles:jest.fn(async(id:string)=>[{code:id==='1'?'ADMIN':'USER'}])};
    ownership={devices:{findDeviceById:jest.fn(async(id:string)=>({id})),getActiveAssignment:jest.fn(async(id:string)=>({userId:id==='42'?'7':'8'})),users},
      findDeviceIdByUid:jest.fn(async(uid:string)=>uid==='robot-a'?'42':uid==='robot-b'?'43':uid==='robot-c'?'44':null),
      validateDeviceCredential:jest.fn(async(_:string,hash:string)=>!revoked&&!expired&&hash===(await import('node:crypto')).createHash('sha256').update(credential).digest('hex')),
      verifyDeviceOwnership:jest.fn(async(user:string,device:string)=>!revoked&&((user==='7'&&['42','44'].includes(device))||(user==='8'&&device==='43'))?{id:device}:null)};
    ai={requireApprovedRobot:jest.fn(async()=>{}),users,ownership,profile:jest.fn(async(user:string)=>profile(user)),scope:jest.fn(async()=>'USER'),
      provider:jest.fn(async(id:string)=>({id,code:'LOCAL',name:`Local-${id}`,isEnabled:1})),
      model:jest.fn(async(id:string)=>({id,providerId:id==='3'?'2':'4',modelCode:`local-${id}`,capability:'llm',isEnabled:1}))};
    tx={ai,now:jest.fn(async()=>now),request:jest.fn(async(id:string)=>clone(records.find(r=>r.requestId===id)??null)),
      policies:jest.fn(async(userId:string,providerId:string)=>[{id:'1',userId,providerId,requestsPerMinute:null,requestsPerDay:100,tokensPerMonth:'1000'}]),
      context:jest.fn(async(i:any)=>i.conversationId),
      userMinuteRequests:jest.fn(async(userId:string)=>String(records.filter(r=>r.userId===userId&&r.occurredAt.getTime()>now.getTime()-60000).length)),
      totals:jest.fn(async(userId:string,providerId:string)=>{
        const rows=records.filter(r=>r.userId===userId&&r.providerId===providerId);
        return {minuteRequests:String(rows.filter(r=>r.occurredAt.getTime()>now.getTime()-60000).length),dayRequests:String(rows.length),
          monthTokens:String(rows.filter(r=>r.finalizedAt).reduce((s,r)=>s+r.inputTokens+r.outputTokens,0)),
          reservedTokens:String(rows.filter(r=>!r.finalizedAt).reduce((s,r)=>s+Number(r.reservedTokens??0),0)),unboundedRequests:'0'};
      }),
      admit:jest.fn(async(i:any,fingerprint:string,policyId:string,_:unknown,conversationId:string|null,occurredAt:Date,reportDueAt:Date)=>records.push({...i,
        id:String(records.length+1),fingerprint,policyId,conversationId,occurredAt,reportDueAt,reservedTokens:i.maxTotalTokens,status:'admitted',finalizedAt:null,reportFingerprint:null})),
      finalize:jest.fn(async(row:any,u:any,fingerprint:string,time:Date)=>Object.assign(records.find(r=>r.id===row.id),u,{reportFingerprint:fingerprint,finalizedAt:time})),
      markMissing:jest.fn(async(row:any)=>{records.find(r=>r.id===row.id).status='report_missing';}),audit:jest.fn()};
    let tail=Promise.resolve();const quotaRepo={assertSchema:jest.fn(async()=>{if(!schema){const {ConflictException}=await import('@nestjs/common');throw new ConflictException('QUOTA_SCHEMA_NOT_READY');}}),
      locateRequest:jest.fn(async(id:string)=>clone(records.find(r=>r.requestId===id)??null)),
      transaction:jest.fn(async(work:any)=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;const snapshot=clone(records);
        try{return await work(tx);}catch(e){records=snapshot;throw e;}finally{release();}})};
    const pool={execute:jest.fn(async(sql:string,values:unknown[])=>{
      if(sql.includes('FROM users WHERE id'))return [[user(String(values[0]))]];
      if(sql.includes('FROM user_roles ur'))return [[{id:'2',code:String(values[0])==='1'?'ADMIN':'USER',name:'Fixture'}]];
      throw new Error('Unexpected SQL: fixture refuses real DB access');}),end:jest.fn()};
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(MYSQL_POOL).useValue(pool)
      .overrideProvider(AdminSeeder).useValue({onApplicationBootstrap:jest.fn()})
      .overrideProvider(OwnershipRepository).useValue({withTransaction:async(work:any)=>work(ownership)})
      .overrideProvider(AiProvidersRepository).useValue({transaction:async(work:any)=>work(ai)})
      .overrideProvider(QuotasRepository).useValue(quotaRepo).compile();
    app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async()=>{if(app)await app.close();for(const [name,value] of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  beforeEach(()=>{records=[];now=date;revoked=expired=disabled=false;schema=true;
    if(app){for(const key of ['DEVICE_AUTH_CONTRACT_APPROVED','AI_CONFIG_CONTRACT_APPROVED','AI_QUOTA_CONTRACT_APPROVED'])app.get(ConfigService).set(key,'true');}});
  const call=(path:string,token:string|undefined,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const request=(n:number,userId='7',providerId='2')=>({requestId:`integration_request_${n.toString().padStart(4,'0')}`,userId,deviceId:userId==='7'?'42':'43',providerId,modelId:providerId==='2'?'3':'5',maxTotalTokens:'10'});
  const report=(n:number,status='success')=>({requestId:request(n).requestId,providerId:'2',status,inputTokens:2,outputTokens:3,durationMs:10});
  function jwt(exp=Math.floor(Date.now()/1000)+60,typ='access',sub='1'){
    const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub,exp,typ,iss:'aiva-iot',aud:'aiva-api'})).toString('base64url');
    return `${h}.${p}.${createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url')}`;
  }
  it.each([['/internal/devices/authorize','device'],['/internal/ai/resolve-config','config'],['/internal/ai/authorize-request','quota'],['/internal/ai/usage','quota']])('global guards preserve service boundary %s',async(path,scope)=>{
    for(const token of [undefined,jwt(),jwt(1),...Object.entries(tokens).filter(([key])=>key!==scope).map(([,v])=>v)])expect((await call(path,token,{})).status).toBe(401);
  });
  it('authenticates owner and rejects missing/wrong/revoked/expired device credentials',async()=>{
    const body={deviceUid:'robot-a',credential};
    expect(await (await call('/internal/devices/authorize',tokens.device,body)).json()).toEqual({allowed:true,deviceId:'42',ownerUserId:'7'});
    expect((await call('/internal/devices/authorize',tokens.device,{deviceUid:'robot-a'})).status).toBe(400);
    expect((await call('/internal/devices/authorize',tokens.device,{...body,credential:'x'.repeat(43)})).status).toBe(401);
    revoked=true;expect((await call('/internal/devices/authorize',tokens.device,body)).status).toBe(401);revoked=false;expired=true;
    expect((await call('/internal/devices/authorize',tokens.device,body)).status).toBe(401);
    expired=false;disabled=true;expect((await call('/internal/devices/authorize',tokens.device,body)).status).toBe(403);
  });
  it('resolves independent user/device profiles without secret delivery or cross-owner access',async()=>{
    for(const [userId,deviceId] of [['7','42'],['8','43']]){
      const response=await call('/internal/ai/resolve-config',tokens.config,{userId,deviceId});expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({userId,profile:{systemPrompt:`profile-${userId}`,voiceCode:`voice-${userId}`},credentialScope:'NONE',credentialReference:null});
    }
    expect((await call('/internal/ai/resolve-config',tokens.config,{userId:'7',deviceId:'43'})).status).toBe(403);
    expect((await call('/internal/ai/resolve-config',tokens.config,{userId:'7',secret:'invalid'})).status).toBe(400);
  });
  it('enforces 12/user/rolling 60s across providers and devices with independent users',async()=>{
    const results=await Promise.all(Array.from({length:13},(_,n)=>call('/internal/ai/authorize-request',tokens.quota,{...request(n,'7',n%2?'4':'2'),deviceId:n%2?'44':'42'})));
    expect(results.filter(r=>r.status===200)).toHaveLength(12);expect(results.filter(r=>r.status===429)).toHaveLength(1);
    expect((await call('/internal/ai/authorize-request',tokens.quota,request(99,'8'))).status).toBe(200);
    now=new Date(date.getTime()+59999);expect((await call('/internal/ai/authorize-request',tokens.quota,request(100))).status).toBe(429);
    now=new Date(date.getTime()+60000);expect((await call('/internal/ai/authorize-request',tokens.quota,request(101))).status).toBe(200);
  });
  it.each(['success','failed','cancelled'])('settles %s once and rejects conflicting reports',async status=>{
    expect((await call('/internal/ai/authorize-request',tokens.quota,request(1))).status).toBe(200);
    expect(await (await call('/internal/ai/authorize-request',tokens.quota,request(1))).json()).toMatchObject({executionAllowed:false,replayed:true});
    expect((await call('/internal/ai/authorize-request',tokens.quota,{...request(1),maxTotalTokens:'11'})).status).toBe(409);
    const first=await call('/internal/ai/usage',tokens.quota,report(1,status));expect(first.status).toBe(200);expect(await first.json()).toMatchObject({recorded:true,replayed:false});
    expect(await (await call('/internal/ai/usage',tokens.quota,report(1,status))).json()).toMatchObject({recorded:true,replayed:true});
    expect((await call('/internal/ai/usage',tokens.quota,{...report(1,status),outputTokens:9})).status).toBe(409);
    expect(records).toHaveLength(1);expect(records[0].outputTokens).toBe(3);
  });
  it('timeout keeps reservation; late usage settles after revoke and contract disable',async()=>{
    await call('/internal/ai/authorize-request',tokens.quota,request(1));now=new Date(date.getTime()+30000);
    expect(await (await call('/internal/ai/authorize-request',tokens.quota,request(1))).json()).toMatchObject({reason:'USAGE_REPORT_MISSING',executionAllowed:false});
    expect(records[0].reservedTokens).toBe('10');expect(records[0].finalizedAt).toBeNull();
    revoked=disabled=true;app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','false');
    expect((await call('/internal/ai/usage',tokens.quota,report(1,'cancelled'))).status).toBe(200);
  });
  it('fails closed on unapproved contracts, invalid schema and DB errors with safe responses',async()=>{
    app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','false');expect((await call('/internal/ai/authorize-request',tokens.quota,request(1))).status).toBe(403);
    app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','true');schema=false;expect((await call('/internal/ai/authorize-request',tokens.quota,request(1))).status).toBe(409);
    schema=true;tx.totals.mockRejectedValueOnce(new Error('SECRET_SQL_DETAILS'));
    const response=await call('/internal/ai/authorize-request',tokens.quota,request(1));expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('SECRET_SQL_DETAILS');
    expect(records).toHaveLength(0);
  });
  it('accepts actual application access JWT for Admin quota route and rejects expired/refresh/User tokens',async()=>{
    // Missing schema deliberately short-circuits policy DB reads after guard verification.
    schema=false;
    for(const [token,status] of [[jwt(),409],[jwt(1),401],[jwt(undefined,'refresh'),401],[jwt(undefined,'access','7'),403]] as const){
      expect((await fetch(base+'/admin/ai/quotas/users/7/providers/2',{headers:{authorization:`Bearer ${token}`}})).status).toBe(status);
    }
  });
  const python=resolve(__dirname,'../../AI_SERVER/.venv-win/Scripts/python.exe');
  (existsSync(python)?it:it.skip)('calls real TCP HTTP using the unchanged AI_SERVER BackendClient (mock Backend repositories)',async()=>{
    const script=`import asyncio,time,uuid
from pydantic import SecretStr
from app.clients.backend import BackendClient,ServiceTokens,ClientLimits
from app.models import backend as dto
from app.services.audio_context import AudioContext
def context(): return AudioContext(deadline=time.monotonic()+5)
async def main():
 async with BackendClient('${base || 'BASE'}',ServiceTokens(SecretStr('${tokens.device}'),SecretStr('${tokens.config}'),SecretStr('${tokens.quota}')),ClientLimits(5,2,65536),allow_local_http=True) as api:
  auth=await api.authorize(dto.DeviceProof(deviceUid='robot-a',credential=SecretStr('${credential}')),context())
  cfg=await api.resolve_config(dto.ConfigRequest(userId=auth.ownerUserId,deviceId=auth.deviceId),context())
  rid=str(uuid.uuid4())
  admission=await api.admit(dto.Admission(requestId=rid,userId=auth.ownerUserId,deviceId=auth.deviceId,providerId=cfg.provider.id,modelId=cfg.model.id,maxTotalTokens='10'),context())
  assert admission.executionAllowed
  usage=await api.report_usage(dto.UsageReport(requestId=rid,providerId=cfg.provider.id,status='success',inputTokens=2,outputTokens=3,durationMs=10),context())
  assert usage.recorded
  print('AI_SERVER_CLIENT_HTTP_PASS')
asyncio.run(main())`;
    const {stdout}=await promisify(execFile)(python,['-B','-c',script.replace('BASE',base)],{cwd:resolve(__dirname,'../../AI_SERVER'),timeout:15000});
    expect(stdout.trim()).toBe('AI_SERVER_CLIENT_HTTP_PASS');expect(records).toHaveLength(1);
  },20000);
});
