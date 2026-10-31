import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { UsersService } from '../src/modules/users/users.service';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { UserPairingGuard } from '../src/modules/pairing/user-pairing.guard';
import { AdminPairingController, UserPairingController } from '../src/modules/pairing/pairing.controller';
import { PairingService } from '../src/modules/pairing/pairing.service';
import { PairingRepository } from '../src/modules/pairing/pairing.repository';

const secret='test-only-pairing-access-jwt-secret-32bytes';
const config=new ConfigService({ADMIN_ACCESS_JWT_SECRET:secret,ADMIN_ACCESS_JWT_ISSUER:'aiva-test',ADMIN_ACCESS_JWT_AUDIENCE:'admin'});
const users={canLogin:jest.fn(),getUserRole:jest.fn()};
const repository={withTransaction:jest.fn(),list:jest.fn()};
const role=(id:string)=>id==='1'?'ADMIN':'USER';
const tx={
  users:{findByIdForUpdate:jest.fn(),findUserRoles:jest.fn()},
  findCodeByHash:jest.fn(),lockCode:jest.fn(),findDeviceById:jest.fn(),
  getActiveAssignment:jest.fn(),resetAllowsPairing:jest.fn(),hasPendingRequest:jest.fn(),
  createRequest:jest.fn(),setLifecycle:jest.fn(),findRequest:jest.fn(),consumeCode:jest.fn(),
  createAssignment:jest.fn(),reviewRequest:jest.fn(),writePairingAudit:jest.fn(),writePairingRequestAudit:jest.fn(),hasAnyPending:jest.fn(),
};
@Module({controllers:[UserPairingController,AdminPairingController],providers:[PairingService,AdminDeviceGuard,UserPairingGuard,
  {provide:ConfigService,useValue:config},{provide:UsersService,useValue:users},{provide:PairingRepository,useValue:repository}]})
class TestModule{}
function token(sub:string,expired=false){
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({sub,iss:'aiva-test',aud:'admin',exp:expired?1:Math.floor(Date.now()/1000)+60})).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256',secret).update(`${header}.${payload}`).digest('base64url')}`;
}

describe('Pairing HTTP authentication, validation and contracts',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;
  beforeAll(async()=>{
    app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
    base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async()=>{await app.close();});
  beforeEach(()=>{
    users.canLogin.mockResolvedValue({allowed:true});users.getUserRole.mockImplementation(async id=>role(id));
    tx.users.findByIdForUpdate.mockImplementation(async id=>({id,status:'active',email_verified_at:new Date()}));
    tx.users.findUserRoles.mockImplementation(async id=>[{code:role(id)}]);
    tx.findCodeByHash.mockResolvedValue({id:'5',deviceId:'42',usable:1,createdAt:new Date()});
    tx.lockCode.mockResolvedValue({id:'5',deviceId:'42',usable:1,createdAt:new Date()});
    tx.findDeviceById.mockResolvedValue({id:'42',lifecycleStatus:'available'});
    tx.getActiveAssignment.mockResolvedValue(null);tx.resetAllowsPairing.mockResolvedValue(true);
    tx.hasPendingRequest.mockResolvedValue(false);tx.createRequest.mockResolvedValue('10');
    tx.findRequest.mockResolvedValue({id:'10',deviceId:'42',userId:'7',pairingCodeId:'5',status:'pending'});
    tx.hasAnyPending.mockResolvedValue(false);
    repository.withTransaction.mockImplementation(async work=>work(tx));
    repository.list.mockImplementation(async (q,userId)=>({items:[{id:'10',deviceId:'42',userId:userId??'7',status:'PENDING'}],
      pagination:{page:q.page,limit:q.limit,total:1}}));
  });
  async function call(path:string,sub:string|null='7',method='GET',body?:unknown,jwt?:string){
    return fetch(base+path,{method,headers:{...(sub===null?{}:{authorization:`Bearer ${jwt??token(sub)}`}),
      ...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  }
  const userPath='/user/devices/pairing-requests';const adminPath='/admin/pairing-requests';
  it('creates 201 PENDING bound to JWT user identity, never returns the code/hash',async()=>{
    const response=await call(userPath,'7','POST',{pairingCode:'ABC123'});
    expect(response.status).toBe(201);expect(await response.json()).toEqual({id:'10',deviceId:'42',status:'PENDING'});
    expect(tx.createRequest).toHaveBeenCalledWith('42','7','5');
  });
  it('User sees own list and cannot inject another identity',async()=>{
    const response=await call(userPath+'?status=PENDING&page=2&limit=3','8');
    expect(response.status).toBe(200);expect(repository.list).toHaveBeenCalledWith({page:2,limit:3,status:'pending'},'8');
    expect((await call(userPath+'?userId=7','8')).status).toBe(400);
    expect((await call(userPath,'8','POST',{pairingCode:'ABC123',userId:'7'})).status).toBe(400);
  });
  it('Admin lists all requests',async()=>{
    expect((await call(adminPath,'1')).status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith({page:1,limit:20},undefined);
  });
  it('Admin approval returns 200 and assignment',async()=>{
    const response=await call(adminPath+'/10/approve','1','POST',{reviewNote:'Approved'});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'APPROVED',assignment:{deviceId:'42',userId:'7'}});
    expect(tx.writePairingAudit).toHaveBeenCalledWith('1',expect.objectContaining({id:'10'}),'approved','Approved');
  });
  it('Admin rejection returns 200 with optional note and no assignment',async()=>{
    const response=await call(adminPath+'/10/reject','1','POST',{reviewNote:'Denied'});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'REJECTED',reviewNote:'Denied'});
    expect(tx.createAssignment).not.toHaveBeenCalled();expect(tx.consumeCode).not.toHaveBeenCalled();
  });
  it('allows omitted review body',async()=>{
    const response=await call(adminPath+'/10/reject','1','POST');
    expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'REJECTED',reviewNote:null});
  });
  it.each([[userPath,'GET'],[userPath,'POST'],[adminPath,'GET'],[adminPath+'/10/approve','POST'],[adminPath+'/10/reject','POST']])(
    'requires JWT for %s %s',async(path,method)=>{
      expect((await call(path,null,method)).status).toBe(401);
      expect(repository.withTransaction).not.toHaveBeenCalled();expect(repository.list).not.toHaveBeenCalled();
    });
  it('denies invalid/expired tokens on User routes',async()=>{
    expect((await call(userPath,'7','GET',undefined,'bad-token')).status).toBe(401);
    expect((await call(userPath,'7','GET',undefined,token('7',true))).status).toBe(401);
  });
  it.each([[adminPath,'GET'],[adminPath+'/10/approve','POST'],[adminPath+'/10/reject','POST']])(
    'denies non-Admin on %s',async(path,method)=>{expect((await call(path,'7',method)).status).toBe(403);});
  it('denies Admin on User-only routes and ineligible accounts',async()=>{
    expect((await call(userPath,'1')).status).toBe(403);users.canLogin.mockResolvedValue({allowed:false});
    expect((await call(userPath,'7')).status).toBe(403);
  });
  it.each([{}, {pairingCode:'short'}, {pairingCode:['ABC123']}, {pairingCode:'ABC123',extra:1}])('rejects malformed body %j',async body=>{
    expect((await call(userPath,'7','POST',body)).status).toBe(400);
    expect(repository.withTransaction).not.toHaveBeenCalled();
  });
  it.each([{reviewNote:'x'.repeat(501)},{reviewNote:123},{reviewNote:null},{reviewNote:'bad\u0000note'},{adminId:'2'},[]])(
    'rejects invalid review body %j',async body=>{expect((await call(adminPath+'/10/approve','1','POST',body)).status).toBe(400);});
  it.each(['0','-1','abc','9223372036854775808'])('rejects request ID %s',async id=>{
    expect((await call(adminPath+`/${id}/reject`,'1','POST',{})).status).toBe(400);
  });
  it.each(['status=unknown','page=0','limit=101','status=pending&status=approved'])('rejects invalid list %s',async query=>{
    expect((await call(adminPath+'?'+query,'1')).status).toBe(400);
  });
  it('returns 404 for missing request and 409 for duplicate/processed request',async()=>{
    tx.findRequest.mockResolvedValueOnce(null);
    expect((await call(adminPath+'/10/approve','1','POST',{})).status).toBe(404);
    tx.findRequest.mockResolvedValue({id:'10',deviceId:'42',status:'approved'});
    expect((await call(adminPath+'/10/approve','1','POST',{})).status).toBe(409);
    tx.hasPendingRequest.mockResolvedValue(true);
    expect((await call(userPath,'7','POST',{pairingCode:'ABC123'})).status).toBe(409);
  });
});
