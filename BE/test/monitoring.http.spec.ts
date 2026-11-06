import request from 'supertest';
import { contractApp } from './contract-app.fixture';
import { MonitoringController } from '../src/modules/monitoring/monitoring.controller';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';

describe('Current monitoring HTTP contract, isolated service',()=>{
  let fixture:Awaited<ReturnType<typeof contractApp>>;
  const service={dashboard:jest.fn(),instances:jest.fn(),heartbeat:jest.fn(),metrics:jest.fn()};
  beforeAll(async()=>{fixture=await contractApp(MonitoringController,[{provide:MonitoringService,useValue:service}]);});
  afterAll(async()=>{await fixture.app.close();});
  beforeEach(()=>{service.dashboard.mockResolvedValue({devices:2});service.instances.mockResolvedValue([]);
    service.heartbeat.mockResolvedValue({id:'9',status:'online'});service.metrics.mockResolvedValue({id:'12'});});
  const server=()=>fixture.app.getHttpServer();
  it.each(['/admin/dashboard','/admin/monitoring/instances'])('requires authenticated ADMIN for %s',async path=>{
    await request(server()).get(path).expect(401);
    await request(server()).get(path).auth(await fixture.token('7'),{type:'bearer'}).expect(403);
    expect(service.dashboard).not.toHaveBeenCalled();expect(service.instances).not.toHaveBeenCalled();
    await request(server()).get(path).auth(await fixture.token('1'),{type:'bearer'}).expect(200);
  });
  it('accepts admin instance heartbeat and metrics with correct instance ID',async()=>{
    await request(server()).post('/admin/monitoring/instances/heartbeat').auth(await fixture.token('1'),{type:'bearer'})
      .send({instance_code:'test-instance',status:'online'}).expect(201);
    expect(service.heartbeat).toHaveBeenCalledWith({instance_code:'test-instance',status:'online'});
    await request(server()).post('/admin/monitoring/instances/9/metrics').auth(await fixture.token('1'),{type:'bearer'})
      .send({cpu_percent:10,active_sessions:2}).expect(201);
    expect(service.metrics).toHaveBeenCalledWith('9',{cpu_percent:10,active_sessions:2});
  });
  it.each([{}, {instance_code:'test',status:'unknown'}, {instance_code:'test',extra:1}])('rejects invalid heartbeat %j',async body=>{
    await request(server()).post('/admin/monitoring/instances/heartbeat').auth(await fixture.token('1'),{type:'bearer'}).send(body).expect(400);
    expect(service.heartbeat).not.toHaveBeenCalled();
  });
  it.each([{active_sessions:-1},{active_sessions:1.5},{cpu_percent:'bad'},{extra:1}])('rejects invalid metrics %j',async body=>{
    await request(server()).post('/admin/monitoring/instances/9/metrics').auth(await fixture.token('1'),{type:'bearer'}).send(body).expect(400);
    expect(service.metrics).not.toHaveBeenCalled();
  });
  it('User cannot write instance heartbeat or metrics',async()=>{
    await request(server()).post('/admin/monitoring/instances/heartbeat').auth(await fixture.token('7'),{type:'bearer'})
      .send({instance_code:'test'}).expect(403);
    await request(server()).post('/admin/monitoring/instances/9/metrics').auth(await fixture.token('7'),{type:'bearer'})
      .send({cpu_percent:1}).expect(403);
    expect(service.heartbeat).not.toHaveBeenCalled();expect(service.metrics).not.toHaveBeenCalled();
  });
});
