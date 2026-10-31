import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { UsersService } from '../src/modules/users/users.service';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { RecoveryController,InternalResetController } from '../src/modules/device-recovery/recovery.controller';
import { RecoveryService } from '../src/modules/device-recovery/recovery.service';
import { ResetSourceGuard } from '../src/modules/device-recovery/reset-source.guard';

const key='test-only-recovery-jwt-secret-at-least-32-bytes';const serviceToken='r'.repeat(43);
const config=new ConfigService({ADMIN_ACCESS_JWT_SECRET:key,ADMIN_ACCESS_JWT_ISSUER:'test',ADMIN_ACCESS_JWT_AUDIENCE:'test',
  DEVICE_RESET_SERVICE_TOKEN:serviceToken,RESET_CONTRACT_APPROVED:'false'});
const users={canLogin:jest.fn().mockResolvedValue({allowed:true}),getUserRole:jest.fn(async(id:string)=>id==='1'?'ADMIN':'USER')};
const recovery={revokeDeviceAssignment:jest.fn(),getRecovery:jest.fn(),getResetStatus:jest.fn(),restoreDeviceAssignment:jest.fn(),requestDeviceReset:jest.fn(),processResetAcknowledgment:jest.fn()};
@Module({controllers:[RecoveryController,InternalResetController],providers:[AdminDeviceGuard,ResetSourceGuard,
  {provide:ConfigService,useValue:config},{provide:UsersService,useValue:users},{provide:RecoveryService,useValue:recovery}]})
class TestModule{}
function token(sub:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'test',aud:'test'})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',key).update(`${h}.${p}`).digest('base64url')}`;}
describe('Recovery HTTP routes/authentication',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;
  beforeAll(async()=>{app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;});
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{config.set('RESET_CONTRACT_APPROVED','false');
    recovery.revokeDeviceAssignment.mockResolvedValue({operationId:'10',deviceId:'42',status:'RESET_PENDING',resetStatus:'PENDING',backupExpiresAt:'2026-11-06T01:00:00Z'});
    recovery.getRecovery.mockResolvedValue({backups:[{backupId:'30',operationId:'10'}]});
    recovery.getResetStatus.mockResolvedValue({jobId:'40',deviceId:'42',status:'PENDING',acknowledgedAt:null});
    recovery.restoreDeviceAssignment.mockResolvedValue({deviceId:'42',status:'RESTORED',ownerUserId:'7'});
    recovery.requestDeviceReset.mockResolvedValue({claimed:true,jobId:'40',deviceId:'42'});recovery.processResetAcknowledgment.mockResolvedValue({jobId:'40',status:'ACKNOWLEDGED'});
  });
  async function call(path:string,method='GET',bearer:string|null=token('1'),body?:unknown){return fetch(base+path,{method,
    headers:{...(bearer?{authorization:`Bearer ${bearer}`}:{ }),'idempotency-key':'revoke_request_0001',
      ...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  it('Admin revoke returns 202 and forwards idempotency key with verified identity',async()=>{
    const response=await call('/admin/devices/42/revoke','POST',token('1'),{reason:'request'});expect(response.status).toBe(202);
    expect(recovery.revokeDeviceAssignment).toHaveBeenCalledWith({userId:'1',role:'ADMIN'},'42',{reason:'request'},'revoke_request_0001');
    expect(JSON.stringify(await response.json())).not.toMatch(/uri|checksum|keyRef/);
  });
  it.each(['/admin/devices/42/recovery','/admin/devices/42/reset-status'])('Admin metadata route %s works',async path=>{
    expect((await call(path)).status).toBe(200);
  });
  it('Admin restore returns 200',async()=>{
    const response=await call('/admin/device-recovery/30/restore','POST');expect(response.status).toBe(200);
    expect(await response.json()).toEqual({deviceId:'42',status:'RESTORED',ownerUserId:'7'});
  });
  it.each([['/admin/devices/42/revoke','POST'],['/admin/devices/42/recovery','GET'],
    ['/admin/devices/42/reset-status','GET'],['/admin/device-recovery/30/restore','POST']])('rejects User/missing JWT %s',async(path,method)=>{
    expect((await call(path,method,token('7'))).status).toBe(403);expect((await call(path,method,null)).status).toBe(401);
  });
  it.each([null,'invalid',token('1')])('rejects untrusted reset source',async bearer=>{
    expect((await call('/internal/device-reset-jobs/claim','POST',bearer,{deviceId:'42'})).status).toBe(401);
    expect(recovery.requestDeviceReset).not.toHaveBeenCalled();
  });
  it('keeps reset contract blocked until explicitly configured',async()=>{
    expect((await call('/internal/device-reset-jobs/claim','POST',serviceToken,{deviceId:'42'})).status).toBe(403);
    expect((await call('/internal/device-reset-jobs/40/ack','POST',serviceToken,{})).status).toBe(403);
  });
  it('exposes claim/ACK only to simulated approved service channel',async()=>{
    config.set('RESET_CONTRACT_APPROVED','true');
    expect((await call('/internal/device-reset-jobs/claim','POST',serviceToken,{deviceId:'42'})).status).toBe(200);
    expect((await call('/internal/device-reset-jobs/40/ack','POST',serviceToken,{})).status).toBe(200);
    expect(recovery.processResetAcknowledgment).toHaveBeenCalledWith('40',{});
  });
});
