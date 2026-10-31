import 'reflect-metadata';
import { Module,ForbiddenException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { UsersService } from '../src/modules/users/users.service';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { UserPairingGuard } from '../src/modules/pairing/user-pairing.guard';
import { QuotaSourceGuard } from '../src/modules/quotas/quota-source.guard';
import { QuotasService } from '../src/modules/quotas/quotas.service';
import { AdminQuotasController,InternalQuotasController,UserUsageController } from '../src/modules/quotas/quotas.controller';

const jwtKey='test-only-quota-http-jwt-key-at-least-32bytes';const serviceToken='q'.repeat(43);
const config=new ConfigService({ADMIN_ACCESS_JWT_SECRET:jwtKey,ADMIN_ACCESS_JWT_ISSUER:'test',ADMIN_ACCESS_JWT_AUDIENCE:'test',AI_QUOTA_SERVICE_TOKEN:serviceToken});
const users={canLogin:jest.fn(async()=>({allowed:true})),getUserRole:jest.fn(async(id:string)=>id==='1'?'ADMIN':'USER')};
const quotas={getQuotaPolicy:jest.fn(),updateQuotaPolicy:jest.fn(),getUsageStatistics:jest.fn(),authorizeAIRequest:jest.fn(),recordAIUsage:jest.fn()};
@Module({controllers:[AdminQuotasController,UserUsageController,InternalQuotasController],providers:[AdminDeviceGuard,UserPairingGuard,QuotaSourceGuard,
  {provide:ConfigService,useValue:config},{provide:UsersService,useValue:users},{provide:QuotasService,useValue:quotas}]})
class TestModule{}
function token(sub:string){const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'test',aud:'test'})).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256',jwtKey).update(`${header}.${payload}`).digest('base64url')}`;}
describe('Quota HTTP roles/service authentication and routing',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>,base:string;
  beforeAll(async()=>{app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;});
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{quotas.getQuotaPolicy.mockResolvedValue({userId:'7',providerId:'2',policyId:'1',mode:'UNLIMITED'});
    quotas.updateQuotaPolicy.mockResolvedValue({userId:'7',providerId:'2',policyId:'2',mode:'BLOCKED'});
    quotas.getUsageStatistics.mockResolvedValue({requestsUsed:'1',inputTokens:'2',outputTokens:'3'});
    quotas.authorizeAIRequest.mockResolvedValue({allowed:true,requestId:'request_test_00000001',executionAllowed:true});
    quotas.recordAIUsage.mockResolvedValue({requestId:'request_test_00000001',status:'SUCCESS',recorded:true,replayed:false});});
  async function call(path:string,method='GET',bearer:string|null=token('1'),body?:unknown){return fetch(base+path,{method,
    headers:{...(bearer?{authorization:`Bearer ${bearer}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  const policy='/admin/ai/quotas/users/7/providers/2';
  it('Admin reads and configures policy with current identity and optimistic version',async()=>{
    expect((await call(policy)).status).toBe(200);expect(quotas.getQuotaPolicy).toHaveBeenCalledWith({userId:'1',role:'ADMIN'},'7','2');
    expect((await call(policy,'PUT',token('1'),{mode:'BLOCKED',expectedPolicyId:'1'})).status).toBe(200);
    expect(quotas.updateQuotaPolicy).toHaveBeenCalledWith({userId:'1',role:'ADMIN'},'7','2',{mode:'BLOCKED',expectedPolicyId:'1'});
  });
  it.each(['GET','PUT'])('denies User/missing JWT on Admin %s',async method=>{
    expect((await call(policy,method,token('7'),method==='PUT'?{}:undefined)).status).toBe(403);
    expect((await call(policy,method,null,method==='PUT'?{}:undefined)).status).toBe(401);
    expect(quotas.updateQuotaPolicy).not.toHaveBeenCalled();
  });
  it('User statistics always pass verified JWT identity; Admin has separate statistics route',async()=>{
    expect((await call('/user/ai/usage?providerId=2','GET',token('7'))).status).toBe(200);
    expect(quotas.getUsageStatistics).toHaveBeenCalledWith({userId:'7',role:'USER'},{providerId:'2'});
    expect((await call('/admin/ai/usage?userId=7&providerId=2')).status).toBe(200);
    expect(quotas.getUsageStatistics).toHaveBeenCalledWith({userId:'1',role:'ADMIN'},{userId:'7',providerId:'2'});
  });
  it.each([['/user/ai/usage','1'],['/admin/ai/usage','7']])('denies wrong role on %s',async(path,userId)=>{
    expect((await call(path,'GET',token(userId))).status).toBe(403);
  });
  it.each(['/internal/ai/authorize-request','/internal/ai/usage'])('requires independent service token on %s',async path=>{
    for(const bearer of [null,'bad-token',token('1')])expect((await call(path,'POST',bearer,{})).status).toBe(401);
    expect(quotas.authorizeAIRequest).not.toHaveBeenCalled();expect(quotas.recordAIUsage).not.toHaveBeenCalled();
  });
  it('service can report an admitted request even if admission is disabled; neither route returns secrets',async()=>{
    quotas.authorizeAIRequest.mockRejectedValue(new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'}));
    expect((await call('/internal/ai/authorize-request','POST',serviceToken,{})).status).toBe(403);
    const response=await call('/internal/ai/usage','POST',serviceToken,{requestId:'request_test_00000001'});expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret|cipher|serviceToken/);
  });
  it('preserves 429 quota denial machine reason',async()=>{
    const {HttpException}=await import('@nestjs/common');quotas.authorizeAIRequest.mockRejectedValue(new HttpException({allowed:false,reason:'QUOTA_EXCEEDED'},429));
    const response=await call('/internal/ai/authorize-request','POST',serviceToken,{});expect(response.status).toBe(429);
    expect(await response.json()).toEqual({allowed:false,reason:'QUOTA_EXCEEDED'});
  });
});
