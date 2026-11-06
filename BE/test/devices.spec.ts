import request from 'supertest';
import { contractApp } from './contract-app.fixture';
import { DevicesController } from '../src/modules/devices/devices.controller';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { PairingService } from '../src/modules/pairing/pairing.service';

describe('Current devices HTTP contract, real service with isolated repository',()=>{
  let fixture:Awaited<ReturnType<typeof contractApp>>;
  const repo={listDevices:jest.fn(),findOwnedByUser:jest.fn(),transaction:jest.fn(),findById:jest.fn(),
    assertPairingReady:jest.fn(),createPairingCode:jest.fn(),audit:jest.fn()};
  beforeAll(async()=>{fixture=await contractApp(DevicesController,[DevicesService,
    {provide:DevicesRepository,useValue:repo},{provide:PairingService,useValue:{}}]);});
  afterAll(async()=>{await fixture.app.close();});
  beforeEach(()=>{
    repo.listDevices.mockResolvedValue({items:[],total:0});repo.findOwnedByUser.mockResolvedValue(null);
    repo.transaction.mockImplementation(async work=>work(repo));
    repo.findById.mockResolvedValue({id:'42',lifecycle_status:'reset_pending'});
  });
  const server=()=>fixture.app.getHttpServer();
  it('admin lists all; User list stays scoped and includes multiple robots',async()=>{
    await request(server()).get('/devices/admin/all?page=2&limit=5').auth(await fixture.token('1'),{type:'bearer'})
      .expect(200).expect({items:[],total:0,page:2,limit:5,total_pages:0});
    expect(repo.listDevices).toHaveBeenCalledWith(null,2,5);
    repo.listDevices.mockResolvedValue({items:[{id:'42'},{id:'99'}],total:2});
    await request(server()).get('/devices').auth(await fixture.token('7'),{type:'bearer'})
      .expect(200).expect(({body})=>expect(body.items.map((d:{id:string})=>d.id)).toEqual(['42','99']));
    expect(repo.listDevices).toHaveBeenLastCalledWith('7',1,20);
  });
  it('rejects missing authentication and User access to admin list',async()=>{
    await request(server()).get('/devices/admin/all').expect(401);
    await request(server()).get('/devices/admin/all').auth(await fixture.token('7'),{type:'bearer'}).expect(403);
    expect(repo.listDevices).not.toHaveBeenCalled();
  });
  it.each(['page=0','page=1.5','limit=101','limit=abc','extra=1'])('rejects invalid query %s',async query=>{
    await request(server()).get('/devices/admin/all?'+query).auth(await fixture.token('1'),{type:'bearer'}).expect(400);
    expect(repo.listDevices).not.toHaveBeenCalled();
  });
  it('does not reveal a robot owned by another User',async()=>{
    await request(server()).get('/devices/42').auth(await fixture.token('8'),{type:'bearer'}).expect(403);
    expect(repo.findOwnedByUser).toHaveBeenCalledWith('42','8');
  });
  it('direct unlink is forbidden without opening a data transaction',async()=>{
    await request(server()).delete('/devices/42/assignment').auth(await fixture.token('7'),{type:'bearer'})
      .expect(403).expect(({body})=>expect(body.code).toBe('ADMIN_RECOVERY_REQUIRED'));
    expect(repo.transaction).not.toHaveBeenCalled();
  });
  it('reset_pending cannot issue a pairing code',async()=>{
    await request(server()).post('/devices/admin/42/pairing-codes').auth(await fixture.token('1'),{type:'bearer'})
      .send({ttl_minutes:10}).expect(409);
    expect(repo.createPairingCode).not.toHaveBeenCalled();
  });
  it.each([0,61,1.5])('validates TTL %s before opening a transaction',async ttl=>{
    await request(server()).post('/devices/admin/42/pairing-codes').auth(await fixture.token('1'),{type:'bearer'})
      .send({ttl_minutes:ttl}).expect(400);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});
