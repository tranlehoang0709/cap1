import { ConfigService } from '@nestjs/config';
import { MonitoringRepository } from '../src/modules/monitoring/monitoring.repository';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { PresenceSweeper } from '../src/modules/monitoring/presence-sweeper';

describe('Current monitoring repository and presence contract, mocked MySQL',()=>{
  let query:jest.Mock;let repo:MonitoringRepository;let service:MonitoringService;
  beforeEach(()=>{query=jest.fn();repo=new MonitoringRepository({query} as never);service=new MonitoringService(repo);});
  it('presence sweep marks only stale online robots offline and never changes ownership or reset lifecycle',async()=>{
    query.mockResolvedValue([{affectedRows:2}]);expect(await repo.sweepStaleDevices()).toBe(2);
    const [sql,values]=query.mock.calls[0];
    expect(sql).toContain("connection_status='online'");expect(sql).toContain('INTERVAL 120 SECOND');
    expect(sql).not.toMatch(/lifecycle_status|device_assignments|device_reset_jobs/);expect(values).toBeUndefined();
  });
  it('dashboard sweeps stale presence before reporting database counts',async()=>{
    query.mockImplementation(async(sql:string)=>sql.startsWith('UPDATE')?[{affectedRows:1}]:[[{total:3}]]);
    const result=await service.dashboard();expect(result).toMatchObject({users:3,devices:3,assigned_devices:3,online_devices:3,conversations:3,usage_today:3});
    expect(query.mock.calls[0][0]).toMatch(/^UPDATE devices/);
  });
  it('instance heartbeat binds untrusted values rather than composing SQL',async()=>{
    const instance={id:'9',instance_code:"test'instance",status:'degraded'};
    query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([[instance]]);
    expect(await service.heartbeat(instance)).toEqual(instance);
    expect(query.mock.calls[0][0]).not.toContain(instance.instance_code);
    expect(query.mock.calls[0][1]).toEqual([instance.instance_code,'degraded',null]);
  });
  it('metrics retain instance scope and nullable measurements',async()=>{
    query.mockResolvedValue([{insertId:12}]);
    expect(await service.metrics('9',{cpu_percent:42,active_sessions:2})).toEqual({id:'12'});
    expect(query.mock.calls[0][1]).toEqual(['9',42,null,null,null,2,null]);
  });
  it('database failure is propagated, never fabricated as a successful heartbeat',async()=>{
    query.mockRejectedValue(new Error('test database unavailable'));
    await expect(service.heartbeat({instance_code:'test'})).rejects.toThrow('test database unavailable');
  });
});

describe('PresenceSweeper lifecycle',()=>{
  beforeEach(()=>{jest.useFakeTimers();});afterEach(()=>{jest.useRealTimers();});
  it('does not overlap sweeps and shutdown waits for pending work',async()=>{
    let resolve!:()=>void;const sweep=jest.fn(()=>new Promise<void>(r=>{resolve=r;}));
    const worker=new PresenceSweeper({sweepStaleDevices:sweep} as never,new ConfigService());
    worker.onApplicationBootstrap();jest.advanceTimersByTime(360000);expect(sweep).toHaveBeenCalledTimes(1);
    let closed=false;const shutdown=worker.onApplicationShutdown().then(()=>{closed=true;});
    await Promise.resolve();expect(closed).toBe(false);resolve();await shutdown;expect(closed).toBe(true);
    jest.advanceTimersByTime(240000);expect(sweep).toHaveBeenCalledTimes(1);
  });
  it('disabled sweeper never starts',async()=>{
    const sweep=jest.fn();const worker=new PresenceSweeper({sweepStaleDevices:sweep} as never,new ConfigService({HEARTBEAT_SWEEPER_ENABLED:'false'}));
    worker.onApplicationBootstrap();jest.advanceTimersByTime(360000);expect(sweep).not.toHaveBeenCalled();await worker.onApplicationShutdown();
  });
});
