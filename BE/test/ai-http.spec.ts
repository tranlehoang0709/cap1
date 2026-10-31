import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { AIActorGuard,InternalAIConfigGuard } from '../src/modules/ai-providers/ai.guards';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { UserPairingGuard } from '../src/modules/pairing/user-pairing.guard';
import { AiProvidersController,AdminProvidersController } from '../src/modules/ai-providers/ai-providers.controller';
import { AiProfilesController,InternalAIConfigController } from '../src/modules/ai-profiles/ai-profiles.controller';
import { ApiKeysController,SystemApiKeysController } from '../src/modules/api-keys/api-keys.controller';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';
import { UsersService } from '../src/modules/users/users.service';

const jwtKey='test-only-ai-http-key-at-least-32-bytes';const internalToken='i'.repeat(43);
const config=new ConfigService({ADMIN_ACCESS_JWT_SECRET:jwtKey,ADMIN_ACCESS_JWT_ISSUER:'test',ADMIN_ACCESS_JWT_AUDIENCE:'test',
  AI_CONFIG_SERVICE_TOKEN:internalToken,AI_CONFIG_CONTRACT_APPROVED:'false'});
const users={canLogin:jest.fn().mockResolvedValue({allowed:true}),getUserRole:jest.fn(async(id:string)=>id==='1'?'ADMIN':'USER')};
const ai={listAvailableProviders:jest.fn(),updateProviderSettings:jest.fn(),getAIProfile:jest.fn(),updateAIProfile:jest.fn(),
  listCredentialMetadata:jest.fn(),saveApiCredential:jest.fn(),revokeApiCredential:jest.fn(),resolveAIConfiguration:jest.fn()};
@Module({controllers:[AiProvidersController,AdminProvidersController,AiProfilesController,InternalAIConfigController,ApiKeysController,SystemApiKeysController],
  providers:[AIActorGuard,InternalAIConfigGuard,AdminDeviceGuard,UserPairingGuard,
    {provide:ConfigService,useValue:config},{provide:UsersService,useValue:users},{provide:AiProvidersService,useValue:ai}]})
class TestModule{}
function token(sub:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'test',aud:'test'})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url')}`;}
describe('AI routes role/current identity and internal boundary',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;
  beforeAll(async()=>{app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;});
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{config.set('AI_CONFIG_CONTRACT_APPROVED','false');
    ai.listAvailableProviders.mockResolvedValue({providers:[]});ai.updateProviderSettings.mockResolvedValue({id:'2',isEnabled:false});
    ai.getAIProfile.mockResolvedValue({assistantName:'AIVA'});ai.updateAIProfile.mockResolvedValue({assistantName:'AIVA'});
    ai.listCredentialMetadata.mockResolvedValue({credentials:[]});ai.saveApiCredential.mockResolvedValue({id:'9',secretHint:'configured',isActive:true});
    ai.revokeApiCredential.mockResolvedValue({id:'9',isActive:false});ai.resolveAIConfiguration.mockResolvedValue({userId:'7',credentialScope:'NONE'});
  });
  async function call(path:string,method='GET',bearer:string|null=token('7'),body?:unknown){return fetch(base+path,{method,
    headers:{...(bearer?{authorization:`Bearer ${bearer}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  it.each(['1','7'])('Provider list accepts persisted Admin/User %s',async userId=>{
    expect((await call('/ai/providers','GET',token(userId))).status).toBe(200);
    expect(ai.listAvailableProviders).toHaveBeenCalledWith({userId,role:userId==='1'?'ADMIN':'USER'});
  });
  it('Admin provider update is denied to User',async()=>{
    expect((await call('/admin/ai/providers/2','PATCH',token('7'),{isEnabled:false})).status).toBe(403);
    expect((await call('/admin/ai/providers/2','PATCH',token('1'),{isEnabled:false})).status).toBe(200);
  });
  it('User profile routes bind JWT ID rather than injected query ID',async()=>{
    expect((await call('/user/ai/profile?userId=8')).status).toBe(200);
    expect(ai.getAIProfile).toHaveBeenCalledWith({userId:'7',role:'USER'});
    expect((await call('/user/ai/profile','PATCH',token('7'),{assistantName:'AIVA'})).status).toBe(200);
  });
  it.each(['user','admin'])('credential CRUD uses correct %s scope and REST status',async route=>{
    const system=route==='admin';const bearer=token(system?'1':'7');const scope=system?'SYSTEM':'USER';const path=`/${route}/ai/credentials`;
    expect((await call(path,'GET',bearer)).status).toBe(200);
    expect(ai.listCredentialMetadata).toHaveBeenCalledWith({userId:system?'1':'7',role:system?'ADMIN':'USER'},scope);
    expect((await call(path,'POST',bearer,{providerId:'2',label:'key',secret:'test-private-key-only'})).status).toBe(201);
    expect((await call(path+'/9','PATCH',bearer,{label:'new',secret:'test-private-key-only'})).status).toBe(200);
    expect((await call(path+'/9','DELETE',bearer)).status).toBe(200);
    expect(ai.revokeApiCredential).toHaveBeenCalledWith(expect.anything(),scope,'9');
  });
  it.each([['/admin/ai/credentials','7'],['/user/ai/credentials','1'],['/user/ai/profile','1']])('denies wrong role %s',async(path,userId)=>{
    expect((await call(path,'GET',token(userId))).status).toBe(403);
  });
  it.each(['/ai/providers','/user/ai/profile','/user/ai/credentials','/admin/ai/credentials'])('requires JWT %s',async path=>{
    expect((await call(path,'GET',null)).status).toBe(401);
  });
  it.each([null,'bad-token',token('1')])('rejects unauthorized internal caller',async bearer=>{
    expect((await call('/internal/ai/resolve-config','POST',bearer,{userId:'7'})).status).toBe(401);expect(ai.resolveAIConfiguration).not.toHaveBeenCalled();
  });
  it('requires separate contract approval before resolving, with reference-only response',async()=>{
    let response=await call('/internal/ai/resolve-config','POST',internalToken,{userId:'7'});
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({reason:'CONTRACT_NOT_APPROVED'});
    config.set('AI_CONFIG_CONTRACT_APPROVED','true');response=await call('/internal/ai/resolve-config','POST',internalToken,{userId:'7'});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({userId:'7',credentialScope:'NONE'});
  });
});
