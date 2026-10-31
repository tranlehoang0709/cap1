import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { OwnershipService } from '../src/modules/devices/ownership.service';
import { OwnershipRepository,OwnershipTransaction } from '../src/modules/devices/ownership.repository';
import { UserDevicesController,DashboardAccessController,InternalDevicesController } from '../src/modules/devices/ownership.controller';
import { InternalDeviceGuard } from '../src/modules/devices/internal-device.guard';
import { UserPairingGuard } from '../src/modules/pairing/user-pairing.guard';
import { UsersService } from '../src/modules/users/users.service';
import { UserPairingController } from '../src/modules/pairing/pairing.controller';
import { PairingService } from '../src/modules/pairing/pairing.service';

const secret='test-only-ownership-jwt-secret-at-least-32bytes';
const serviceToken='s'.repeat(43);const credential='c'.repeat(43);
let approved=false;
const config={get:jest.fn((key:string)=>({ADMIN_ACCESS_JWT_SECRET:secret,ADMIN_ACCESS_JWT_ISSUER:'test',
  ADMIN_ACCESS_JWT_AUDIENCE:'user',AI_DEVICE_SERVICE_TOKEN:serviceToken,
  DEVICE_AUTH_CONTRACT_APPROVED:approved?'true':'false'} as Record<string,string>)[key])};
const users={canLogin:jest.fn(),getUserRole:jest.fn()};
const repo={getUserDevices:jest.fn(),canAccessDashboard:jest.fn(),withTransaction:jest.fn()};
const tx={devices:{findDeviceById:jest.fn(),getActiveAssignment:jest.fn(),
  users:{findByIdForUpdate:jest.fn(),findUserRoles:jest.fn()}},findDeviceIdByUid:jest.fn(),
  verifyDeviceOwnership:jest.fn(),renameUserDevice:jest.fn(),validateDeviceCredential:jest.fn()};
const pairing={listPairingRequests:jest.fn()};
@Module({controllers:[UserPairingController,UserDevicesController,DashboardAccessController,InternalDevicesController],
  providers:[OwnershipService,UserPairingGuard,InternalDeviceGuard,
    {provide:OwnershipRepository,useValue:repo},{provide:UsersService,useValue:users},
    {provide:ConfigService,useValue:config},{provide:PairingService,useValue:pairing}]})
class TestModule{}

function token(sub='7'){
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60,iss:'test',aud:'user'})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
}
describe('Ownership HTTP and service authorization',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;let service:OwnershipService;
  beforeAll(async()=>{app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
    base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;service=app.get(OwnershipService);});
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{
    approved=false;users.canLogin.mockResolvedValue({allowed:true});users.getUserRole.mockResolvedValue('USER');
    repo.getUserDevices.mockResolvedValue([{id:'42',deviceUid:'robot',displayName:'AIVA',connectionStatus:'offline'}]);
    repo.canAccessDashboard.mockResolvedValue(true);repo.withTransaction.mockImplementation(async work=>work(tx));
    tx.devices.findDeviceById.mockResolvedValue({id:'42',lifecycleStatus:'assigned'});
    tx.devices.getActiveAssignment.mockResolvedValue({deviceId:'42',userId:'7'});
    tx.devices.users.findByIdForUpdate.mockResolvedValue({id:'7',status:'active',email_verified_at:new Date()});
    tx.devices.users.findUserRoles.mockResolvedValue([{code:'USER'}]);
    tx.findDeviceIdByUid.mockResolvedValue('42');tx.validateDeviceCredential.mockResolvedValue(true);
    tx.verifyDeviceOwnership.mockResolvedValue({id:'42',deviceUid:'robot',displayName:'AIVA',connectionStatus:'offline'});
    tx.renameUserDevice.mockResolvedValue(undefined);pairing.listPairingRequests.mockResolvedValue({items:[]});
  });
  async function call(path:string,method='GET',body?:unknown,bearer:string|null=token()){
    return fetch(base+path,{method,headers:{...(bearer?{authorization:`Bearer ${bearer}`}:{ }),
      ...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  }
  const authBody=()=>({deviceUid:'robot',credential});
  it('lists only the authenticated User scope, never an injected filter',async()=>{
    const response=await call('/user/devices?userId=8');expect(response.status).toBe(200);
    expect(await response.json()).toEqual({devices:[{id:'42',deviceUid:'robot',displayName:'AIVA',connectionStatus:'offline'}],total:1});
    expect(repo.getUserDevices).toHaveBeenCalledWith('7');
  });
  it('preserves the static Pairing route before dynamic device ID',async()=>{
    expect((await call('/user/devices/pairing-requests')).status).toBe(200);
    expect(pairing.listPairingRequests).toHaveBeenCalled();expect(repo.withTransaction).not.toHaveBeenCalled();
  });
  it('allows owner read and valid rename with trimmed Unicode name',async()=>{
    expect((await call('/user/devices/42')).status).toBe(200);
    const response=await call('/user/devices/42','PATCH',{displayName:' Phòng khách '});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({id:'42',displayName:'Phòng khách'});
    expect(tx.renameUserDevice).toHaveBeenCalledWith('42','7','Phòng khách');
  });
  it.each(['GET','PATCH'])('conceals other User device on %s',async method=>{
    tx.devices.getActiveAssignment.mockResolvedValue({deviceId:'42',userId:'8'});
    expect((await call('/user/devices/42',method,method==='PATCH'?{displayName:'Mine'}:undefined)).status).toBe(404);
    expect(tx.renameUserDevice).not.toHaveBeenCalled();
  });
  it('rejects unassigned/missing and blocked devices',async()=>{
    tx.devices.getActiveAssignment.mockResolvedValueOnce(null);
    expect((await call('/user/devices/42')).status).toBe(404);
    tx.devices.findDeviceById.mockResolvedValueOnce(null);
    expect((await call('/user/devices/42')).status).toBe(404);
    tx.verifyDeviceOwnership.mockResolvedValue(null);
    expect((await call('/user/devices/42','PATCH',{displayName:'Name'})).status).toBe(409);
  });
  it.each([{displayName:''},{displayName:'  '},{displayName:'x'.repeat(121)},
    {displayName:'\nName'}, {displayName:123},{displayName:'Name',userId:'8'},{}])('rejects invalid rename %j',async body=>{
    expect((await call('/user/devices/42','PATCH',body)).status).toBe(400);expect(tx.renameUserDevice).not.toHaveBeenCalled();
  });
  it.each(['0','abc','9223372036854775808'])('rejects invalid ID %s',async id=>{
    expect((await call(`/user/devices/${id}`)).status).toBe(400);
  });
  it('allows offline ownership for Dashboard; denies absent approved assignment',async()=>{
    let response=await call('/user/dashboard/access');expect(await response.json()).toEqual({allowed:true,reason:null});
    repo.canAccessDashboard.mockResolvedValue(false);response=await call('/user/dashboard/access');
    expect(response.status).toBe(200);expect(await response.json()).toEqual({allowed:false,reason:'NO_APPROVED_DEVICE'});
  });
  it.each(['/user/devices','/user/devices/42','/user/dashboard/access'])('requires USER JWT on %s',async path=>{
    expect((await call(path,'GET',undefined,null)).status).toBe(401);
    users.getUserRole.mockResolvedValue('ADMIN');expect((await call(path)).status).toBe(403);
  });
  it('blocks internal caller without a distinct service credential',async()=>{
    for(const bearer of [null,'invalid',token()]){
      const response=await call('/internal/devices/authorize','POST',authBody(),bearer);
      expect(response.status).toBe(401);expect(await response.json()).toMatchObject({allowed:false,reason:'SERVICE_UNAUTHORIZED'});
    }
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });
  it('keeps unapproved contract blocked at route AND service',async()=>{
    const response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    await expect(service.authorizeDeviceConnection(authBody())).rejects.toMatchObject({status:403});
  });
  it('accepts credential + approved assignment only in a simulated approved contract',async()=>{
    approved=true;const response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(200);expect(await response.json()).toEqual({allowed:true,deviceId:'42',ownerUserId:'7'});
    expect(tx.validateDeviceCredential).toHaveBeenCalledWith('42',createHash('sha256').update(credential).digest('hex'));
    expect(tx.devices.findDeviceById.mock.invocationCallOrder[0]).toBeLessThan(tx.validateDeviceCredential.mock.invocationCallOrder[0]);
  });
  it.each([null,[],{deviceUid:'robot'},{deviceUid:'robot',credential:'short'},{deviceUid:'',credential},
    {deviceUid:'robot',credential,extra:true}])('rejects invalid auth body %j',async body=>{
    approved=true;expect((await call('/internal/devices/authorize','POST',body,serviceToken)).status).toBe(400);
  });
  it.each(['invalid','expired','revoked'])('rejects %s credential without revealing why',async()=>{
    approved=true;tx.validateDeviceCredential.mockResolvedValue(false);
    const response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(401);expect(await response.json()).toMatchObject({allowed:false,reason:'DEVICE_UNAUTHORIZED'});
  });
  it('does not allow UID-only or unknown device',async()=>{
    approved=true;tx.findDeviceIdByUid.mockResolvedValue(null);
    expect((await call('/internal/devices/authorize','POST',authBody(),serviceToken)).status).toBe(401);
  });
  it('allows heartbeat caller to use 404 policy for unknown device without changing authorize policy',async()=>{
    tx.findDeviceIdByUid.mockResolvedValue(null);
    await expect(service.validateAuthorizedDevice(tx as never,'missing',credential,404)).rejects.toMatchObject({status:404});
    await expect(service.validateAuthorizedDevice(tx as never,'missing',credential)).rejects.toMatchObject({status:401});
  });
  it.each(['unassigned','revoked','reset_pending','blocked','pending_pairing'])('denies %s access despite a valid credential',async state=>{
    approved=true;if(state==='unassigned')tx.devices.getActiveAssignment.mockResolvedValue(null);
    else tx.verifyDeviceOwnership.mockResolvedValue(null);
    const response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({allowed:false,reason:'DEVICE_ACCESS_DENIED'});
  });
  it('denies ineligible owner and propagates retry/unavailable with safe reasons',async()=>{
    approved=true;tx.devices.users.findByIdForUpdate.mockResolvedValue({status:'disabled',email_verified_at:null});
    expect((await call('/internal/devices/authorize','POST',authBody(),serviceToken)).status).toBe(403);
    repo.withTransaction.mockRejectedValueOnce({code:'ER_LOCK_DEADLOCK'});
    let response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({reason:'AUTHORIZATION_RETRY'});
    repo.withTransaction.mockRejectedValueOnce(new Error('secret SQL'));
    response=await call('/internal/devices/authorize','POST',authBody(),serviceToken);
    expect(response.status).toBe(500);expect(await response.json()).toEqual({allowed:false,reason:'AUTHORIZATION_UNAVAILABLE'});
  });
  it('revalidates assignment after waiting on a concurrent revoke (transaction model)',async()=>{
    approved=true;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
    tx.devices.findDeviceById.mockImplementationOnce(async()=>{await barrier;return {id:'42',lifecycleStatus:'assigned'};});
    const pending=service.authorizeDeviceConnection(authBody());
    await Promise.resolve();tx.devices.getActiveAssignment.mockResolvedValue(null);release();
    await expect(pending).rejects.toMatchObject({status:403});
  });
});

describe('OwnershipRepository scope, locks and credential predicates',()=>{
  let execute:jest.Mock;let connection:Record<string,jest.Mock>;let repository:OwnershipRepository;let transaction:OwnershipTransaction;
  beforeEach(()=>{
    execute=jest.fn();connection={execute,query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    const pool={execute,getConnection:jest.fn().mockResolvedValue(connection)};
    repository=new OwnershipRepository(pool as never);transaction=new OwnershipTransaction(pool as never,connection as never);
  });
  it('scopes SQL to owner + approved request + lifecycle; offline is irrelevant',async()=>{
    execute.mockResolvedValue([[{id:'42',deviceUid:'r',displayName:null,connectionStatus:'offline',credential_hash:'hidden'}]]);
    const rows=await repository.getUserDevices('7');
    const [sql,values]=execute.mock.calls[0];expect(values).toEqual(['7']);expect(sql).toContain('a.user_id=?');
    expect(sql).toContain("p.status='approved'");expect(sql).toContain("d.lifecycle_status='assigned'");
    expect(sql).toContain('p.device_id=a.device_id AND p.user_id=a.user_id');expect(sql).toContain('device_unlink_operations');
    expect(sql).toContain('device_reset_jobs');expect(sql).not.toMatch(/connection_status\s*=/);
    expect(JSON.stringify(rows)).not.toContain('credential');
  });
  it('Dashboard checks existence, not pending pairing requests',async()=>{
    execute.mockResolvedValueOnce([[]]);await expect(repository.canAccessDashboard('7')).resolves.toBe(false);
    expect(execute.mock.calls[0][0]).toContain('LIMIT 1');expect(execute.mock.calls[0][0]).toContain("p.status='approved'");
  });
  it('checks owner/device together and only changes display name/timestamp',async()=>{
    execute.mockResolvedValue([[]]);await transaction.verifyDeviceOwnership('7','42');
    expect(execute.mock.calls[0][1]).toEqual(['7','42']);
    await transaction.renameUserDevice('42','7','Name');const [sql,values]=execute.mock.calls[1];
    expect(sql).toContain('SET d.display_name=?,d.updated_at=UTC_TIMESTAMP()');expect(sql).toContain('a.user_id=?');
    expect(values).toEqual(['Name','42','7']);
  });
  it('locks credential and checks hash/device/status/revocation/nullable expiry',async()=>{
    execute.mockResolvedValueOnce([[]]);await expect(transaction.validateDeviceCredential('42','hash')).resolves.toBe(false);
    const [sql,values]=execute.mock.calls[0];expect(values).toEqual(['hash','42']);
    for(const predicate of ['credential_hash=?','device_id=?',"status='active'",'revoked_at IS NULL',
      'expires_at IS NULL OR expires_at>UTC_TIMESTAMP()','FOR UPDATE'])expect(sql).toContain(predicate);
    expect(sql.split('FROM')[0]).not.toContain('credential_hash');
  });
  it('commits/release on success; rollback/release on failure',async()=>{
    await repository.withTransaction(async()=>true);expect(connection.commit).toHaveBeenCalled();
    await expect(repository.withTransaction(async()=>{throw new Error('audit');})).rejects.toThrow('audit');
    expect(connection.rollback).toHaveBeenCalled();expect(connection.release).toHaveBeenCalledTimes(2);
  });
});
