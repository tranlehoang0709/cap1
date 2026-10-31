import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';

const execute=jest.fn(async(sql:string,values:unknown[]=[])=>{
  if(sql.includes('FROM users WHERE id'))return [[{id:String(values[0]),email:'fixture@test.invalid',display_name:'Fixture',status:'active',
    email_verified_at:new Date('2026-01-01T00:00:00Z'),last_login_at:null,created_at:new Date(),updated_at:new Date()}]];
  if(sql.includes('FROM user_roles ur'))return [[{id:String(values[0])==='1'?1:2,code:String(values[0])==='1'?'ADMIN':'USER',name:'Fixture role'}]];
  if(sql.includes('COUNT('))return [[{total:0}]];
  if(sql.includes('FROM ai_providers WHERE is_enabled=1'))return [[{id:'1',code:'LOCAL',name:'Local',isEnabled:1}]];
  return [[]];
});
const connection={execute,query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
const mockPool={execute,getConnection:jest.fn(async()=>connection),end:jest.fn()};
jest.mock('mysql2/promise',()=>({...jest.requireActual('mysql2/promise'),createPool:jest.fn(()=>mockPool)}));

describe('Full AppModule HTTP wiring with explicitly mocked MySQL (not DB E2E)',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;
  const key='test-only-app-wiring-signature-key-32bytes';const serviceToken='t'.repeat(43);
  const environment:Record<string,string>={NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true',DB_HOST:'mock.invalid',DB_PORT:'3306',
    DB_USER:'mock',DB_PASSWORD:'test-only',DB_NAME:'aiva_iot_test',HEARTBEAT_SWEEPER_ENABLED:'false',
    ADMIN_ACCESS_JWT_SECRET:key,ADMIN_ACCESS_JWT_ISSUER:'wiring',ADMIN_ACCESS_JWT_AUDIENCE:'wiring',
    AI_DEVICE_SERVICE_TOKEN:serviceToken,DEVICE_AUTH_CONTRACT_APPROVED:'false',
    AI_CONFIG_SERVICE_TOKEN:serviceToken,AI_CONFIG_CONTRACT_APPROVED:'false',
    DEVICE_RESET_SERVICE_TOKEN:serviceToken,RESET_CONTRACT_APPROVED:'false',AI_QUOTA_SERVICE_TOKEN:serviceToken,
    AI_QUOTA_CONTRACT_APPROVED:'false',AI_USAGE_REPORT_SWEEPER_ENABLED:'false'};
  const original:Record<string,string|undefined>={};
  beforeAll(async()=>{
    for(const [name,value]of Object.entries(environment)){original[name]=process.env[name];process.env[name]=value;}
    const {AppModule}=await import('../src/app.module');app=await NestFactory.create(AppModule,{logger:false});
    await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async()=>{if(app)await app.close();for(const name of Object.keys(environment)){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}});
  function token(sub:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'wiring',aud:'wiring'})).toString('base64url');
    return `${h}.${p}.${createHmac('sha256',key).update(`${h}.${p}`).digest('base64url')}`;}
  const get=(path:string,userId='7')=>fetch(base+path,{headers:{authorization:`Bearer ${token(userId)}`}});
  it('boots all real modules and routes a static Pairing path ahead of dynamic device ID',async()=>{
    const response=await get('/user/devices/pairing-requests');expect(response.status).toBe(200);
    expect(await response.json()).toEqual({items:[],pagination:{page:1,limit:20,total:0}});
  });
  it.each([['/admin/devices','1'],['/admin/pairing-requests','1'],['/user/devices','7'],
    ['/user/dashboard/access','7'],['/ai/providers','7'],['/user/ai/profile','7'],
    ['/user/ai/credentials','7'],['/admin/ai/credentials','1']])('wires %s to real guard/controller/service/repository',async(path,userId)=>{
    expect((await get(path,userId)).status).toBe(200);
  });
  it.each(['/admin/devices/42/monitoring','/admin/devices/42/recovery','/admin/devices/42/reset-status'])('finds %s and returns business 404, not a missing route',async path=>{
    const response=await get(path,'1');expect(response.status).toBe(404);expect(await response.json()).toMatchObject({message:'Device not found'});
  });
  it.each(['/internal/devices/authorize','/internal/devices/heartbeat','/internal/ai/resolve-config','/internal/device-reset-jobs/claim','/internal/ai/authorize-request'])('keeps internal contract gated %s',async path=>{
    const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${serviceToken}`}});
    expect(response.status).toBe(403);
  });
  it('User cannot bypass Admin role through the full application graph',async()=>{expect((await get('/admin/devices','7')).status).toBe(403);});
  it('quota routes fail closed without the separately applied schema, before opening a data transaction',async()=>{
    for(const [path,userId]of [['/admin/ai/quotas/users/7/providers/2','1'],['/user/ai/usage','7']]){
      const response=await get(path,userId);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({message:'QUOTA_SCHEMA_NOT_READY'});
    }
    expect(mockPool.getConnection).not.toHaveBeenCalled();
  });
});
