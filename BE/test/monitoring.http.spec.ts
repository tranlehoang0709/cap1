import 'reflect-metadata';
import { Module,NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { UsersService } from '../src/modules/users/users.service';
import { OwnershipService } from '../src/modules/devices/ownership.service';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { InternalDeviceGuard } from '../src/modules/devices/internal-device.guard';
import { UserPairingGuard } from '../src/modules/pairing/user-pairing.guard';
import { AdminMonitoringController,HeartbeatController,UserMonitoringController } from '../src/modules/monitoring/monitoring.controller';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { MonitoringRepository } from '../src/modules/monitoring/monitoring.repository';

const jwtKey='test-only-monitoring-jwt-key-at-least-32bytes';const serviceToken='s'.repeat(43);const credential='c'.repeat(43);
const now=new Date('2026-10-30T01:00:00Z');
const config=new ConfigService({ADMIN_ACCESS_JWT_SECRET:jwtKey,ADMIN_ACCESS_JWT_ISSUER:'test',ADMIN_ACCESS_JWT_AUDIENCE:'test',
  AI_DEVICE_SERVICE_TOKEN:serviceToken,DEVICE_AUTH_CONTRACT_APPROVED:'true',HEARTBEAT_TIMEOUT_SECONDS:'60'});
const users={canLogin:jest.fn(),getUserRole:jest.fn()};
const ownership={validateAuthorizedDevice:jest.fn(),verifyOwnershipInTransaction:jest.fn()};
const repository={transaction:jest.fn()};
const tx={ownership:{devices:{findDeviceById:jest.fn(),users:{findByIdForUpdate:jest.fn(),findUserRoles:jest.fn()}}},
  presence:jest.fn(),updateDevicePresence:jest.fn(),saveDeviceTelemetry:jest.fn(),markDeviceOffline:jest.fn(),telemetry:jest.fn()};
@Module({controllers:[HeartbeatController,AdminMonitoringController,UserMonitoringController],
  providers:[MonitoringService,AdminDeviceGuard,InternalDeviceGuard,UserPairingGuard,
    {provide:ConfigService,useValue:config},{provide:UsersService,useValue:users},
    {provide:OwnershipService,useValue:ownership},{provide:MonitoringRepository,useValue:repository}]})
class TestModule{}
function token(sub:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'test',aud:'test'})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url')}`;}
describe('Monitoring routes HTTP security and contracts',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;
  beforeAll(async()=>{app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;});
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{
    config.set('DEVICE_AUTH_CONTRACT_APPROVED','true');users.canLogin.mockResolvedValue({allowed:true});users.getUserRole.mockImplementation(async(id:string)=>id==='1'?'ADMIN':'USER');
    repository.transaction.mockImplementation(async work=>work(tx));ownership.validateAuthorizedDevice.mockResolvedValue({allowed:true,deviceId:'42',ownerUserId:'7'});
    ownership.verifyOwnershipInTransaction.mockResolvedValue({id:'42'});tx.ownership.devices.findDeviceById.mockResolvedValue({id:'42'});
    tx.ownership.devices.users.findByIdForUpdate.mockResolvedValue({status:'active',email_verified_at:now});tx.ownership.devices.users.findUserRoles.mockResolvedValue([{code:'ADMIN'}]);
    tx.presence.mockResolvedValue({lastSeenAt:null,now});tx.telemetry.mockResolvedValue({wifiRssi:null,freeHeapBytes:null,batteryPercent:null});
    tx.updateDevicePresence.mockResolvedValue(undefined);tx.saveDeviceTelemetry.mockResolvedValue(undefined);
  });
  const body=()=>({deviceUid:'robot',credential,observedAt:now.toISOString()});
  async function call(path:string,method='GET',bearer:string|null=token('7'),data?:unknown){return fetch(base+path,{method,
    headers:{...(bearer?{authorization:`Bearer ${bearer}`}:{ }),...(data===undefined?{}:{'content-type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});}
  it('accepts heartbeat without exposing credentials or owner',async()=>{
    const response=await call('/internal/devices/heartbeat','POST',serviceToken,body());
    expect(response.status).toBe(200);expect(await response.json()).toEqual({accepted:true,deviceId:'42',lastSeenAt:now.toISOString()});
  });
  it.each([null,'bad-token',token('1')])('rejects invalid source before persistence',async bearer=>{
    expect((await call('/internal/devices/heartbeat','POST',bearer,body())).status).toBe(401);expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('rejects unapproved source contract',async()=>{
    config.set('DEVICE_AUTH_CONTRACT_APPROVED','false');
    expect((await call('/internal/devices/heartbeat','POST',serviceToken,body())).status).toBe(403);
  });
  it.each([{deviceUid:'robot',observedAt:now.toISOString()}, {...body(),observedAt:'bad'},
    {...body(),telemetry:{batteryPercent:101}}, {...body(),telemetry:{payload:{credential:'must-not-store'}}}])('rejects invalid event %j',async data=>{
    expect((await call('/internal/devices/heartbeat','POST',serviceToken,data)).status).toBe(400);expect(tx.updateDevicePresence).not.toHaveBeenCalled();
  });
  it('returns 404 for an unknown device and ignores duplicate safely',async()=>{
    ownership.validateAuthorizedDevice.mockRejectedValueOnce(new NotFoundException('Device not found'));
    expect((await call('/internal/devices/heartbeat','POST',serviceToken,body())).status).toBe(404);
    tx.presence.mockResolvedValue({lastSeenAt:now,now});const response=await call('/internal/devices/heartbeat','POST',serviceToken,body());
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({accepted:false,reason:'STALE_OR_DUPLICATE'});
    expect(tx.saveDeviceTelemetry).not.toHaveBeenCalled();
  });
  it.each([['/admin/devices/42/monitoring','1'],['/user/devices/42/monitoring','7']])('reads protected monitoring %s',async(path,userId)=>{
    const response=await call(path,'GET',token(userId));expect(response.status).toBe(200);
    expect(await response.json()).toEqual({deviceId:'42',connectionStatus:'offline',lastSeenAt:null,telemetry:{wifiRssi:null,freeHeapBytes:null,batteryPercent:null}});
  });
  it('hides other User device according to existing 404 policy',async()=>{
    ownership.verifyOwnershipInTransaction.mockRejectedValue(new NotFoundException('Device not found'));
    expect((await call('/user/devices/42/monitoring','GET',token('8'))).status).toBe(404);
    expect(tx.telemetry).not.toHaveBeenCalled();
  });
  it.each([['/admin/devices/42/monitoring','7'],['/user/devices/42/monitoring','1']])('denies wrong role %s',async(path,userId)=>{
    expect((await call(path,'GET',token(userId))).status).toBe(403);expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('denies missing JWT and malformed IDs',async()=>{
    expect((await call('/user/devices/42/monitoring','GET',null)).status).toBe(401);
    expect((await call('/user/devices/abc/monitoring')).status).toBe(400);
  });
  it('returns safe database failure rather than SQL or raw event',async()=>{
    repository.transaction.mockRejectedValue(new Error('secret SQL'));
    const response=await call('/internal/devices/heartbeat','POST',serviceToken,body());expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/credential|secret SQL/);
  });
});
