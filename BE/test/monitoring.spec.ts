import { ConfigService } from '@nestjs/config';
import { ForbiddenException,UnauthorizedException } from '@nestjs/common';
import { MonitoringService,calculateDeviceStatus } from '../src/modules/monitoring/monitoring.service';
import { MonitoringRepository,MonitoringTransaction } from '../src/modules/monitoring/monitoring.repository';
import { OwnershipService } from '../src/modules/devices/ownership.service';
import { heartbeatInput } from '../src/modules/monitoring/dto/heartbeat.dto';
import { PresenceSweeper } from '../src/modules/monitoring/presence-sweeper';
import { validateEnvironment } from '../src/config/configuration';

const now=new Date('2026-10-30T01:00:00Z');const credential='c'.repeat(43);
const event=(observedAt='2026-10-30T01:00:00Z')=>({deviceUid:'robot',credential,observedAt,
  telemetry:{wifiRssi:-65,freeHeapBytes:'123456',batteryPercent:85}});

describe('Presence calculation and input contract',()=>{
  it.each([[null,'offline'],[new Date(now.getTime()-59000),'online'],[new Date(now.getTime()-60000),'offline'],
    [new Date(now.getTime()+1000),'offline'],[now,'online']] as const)('calculates %s -> %s at approved timeout', (lastSeenAt,status)=>{
    expect(calculateDeviceStatus(lastSeenAt,now,60)).toBe(status);
  });
  it('retains exact timestamps, BIGINT heap and optional values',()=>{
    expect(heartbeatInput(event()).telemetry).toEqual({wifiRssi:-65,freeHeapBytes:'123456',batteryPercent:85,payload:null});
    expect(heartbeatInput({...event(),telemetry:undefined}).telemetry).toBeUndefined();
    expect(heartbeatInput({...event(),telemetry:{}}).telemetry).toBeUndefined();
    expect(heartbeatInput({...event(),telemetry:{payload:{uptimeSeconds:10,firmwareVersion:'1.2'}}}).telemetry?.payload).toEqual({uptimeSeconds:10,firmwareVersion:'1.2'});
    expect(heartbeatInput({...event(),telemetry:{freeHeapBytes:'9223372036854775807'}}).telemetry?.freeHeapBytes).toBe('9223372036854775807');
  });
  it.each([{wifiRssi:1},{wifiRssi:-128},{batteryPercent:101},{batteryPercent:0.5},{freeHeapBytes:-1},
    {freeHeapBytes:Number.MAX_SAFE_INTEGER+1},{freeHeapBytes:'9223372036854775808'}, {payload:{secret:'never-store'}},
    {payload:{uptimeSeconds:-1}},{payload:{firmwareVersion:'bad\u0000'}},{unexpected:true}])('rejects telemetry %j',telemetry=>{
    expect(()=>heartbeatInput({...event(),telemetry})).toThrow();
  });
  it.each(['bad','2026-02-30T01:00:00Z','2026-10-30T01:00:00.100Z','2026-10-30T08:00:00+07:00'])('rejects timestamp %s',observedAt=>{
    expect(()=>heartbeatInput(event(observedAt))).toThrow();
  });
  it('rejects missing credential, arbitrary payload and event fields',()=>{
    expect(()=>heartbeatInput({...event(),credential:undefined})).toThrow();
    expect(()=>heartbeatInput({...event(),deviceId:'42'})).toThrow();
  });
  it('validates timeout config without inventing one from transport ping',()=>{
    const env={DB_HOST:'local',DB_PORT:'3306',DB_USER:'aiva',DB_PASSWORD:'',DB_NAME:'aiva_iot'};
    expect(validateEnvironment({...env,HEARTBEAT_TIMEOUT_SECONDS:'60'})).toBeDefined();
    for(const timeout of ['0','abc','2147484','1.5',''])expect(()=>validateEnvironment({...env,HEARTBEAT_TIMEOUT_SECONDS:timeout})).toThrow('HEARTBEAT_TIMEOUT');
    expect(()=>validateEnvironment({...env,HEARTBEAT_SWEEPER_ENABLED:'yes'})).toThrow('HEARTBEAT_SWEEPER');
  });
});

describe('MonitoringService transaction state model',()=>{
  let service:MonitoringService;let repository:any;let ownership:any;let tx:any;let state:any;let config:ConfigService;
  beforeEach(()=>{
    state={lastSeenAt:null,connectionStatus:'offline',samples:[],assignment:{deviceId:'42',userId:'7'}};
    config=new ConfigService({DEVICE_AUTH_CONTRACT_APPROVED:'true',HEARTBEAT_TIMEOUT_SECONDS:'60'});
    tx={ownership:{devices:{findDeviceById:jest.fn().mockResolvedValue({id:'42'}),users:{
      findByIdForUpdate:jest.fn().mockResolvedValue({status:'active',email_verified_at:now}),findUserRoles:jest.fn().mockResolvedValue([{code:'ADMIN'}])}}},
      presence:jest.fn(async()=>({lastSeenAt:state.lastSeenAt,now})),
      updateDevicePresence:jest.fn(async(_:string,t:Date)=>{state.lastSeenAt=t;state.connectionStatus='online';}),
      saveDeviceTelemetry:jest.fn(async(_:string,e:any)=>{if(e.telemetry)state.samples.push(e.telemetry);}),
      markDeviceOffline:jest.fn(async()=>{state.connectionStatus='offline';}),
      telemetry:jest.fn(async()=>state.samples.at(-1)??{wifiRssi:null,freeHeapBytes:null,batteryPercent:null})};
    ownership={validateAuthorizedDevice:jest.fn(async()=>({allowed:true,deviceId:'42',ownerUserId:'7'})),verifyOwnershipInTransaction:jest.fn()};
    let tail=Promise.resolve();repository={transaction:jest.fn(async(work:any)=>{
      const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>release=resolve);await previous;
      const before=structuredClone(state);try{return await work(tx);}catch(error){state=before;throw error;}finally{release();}
    }),markExpiredDevicesOffline:jest.fn()};
    service=new MonitoringService(repository,ownership,config);
  });
  it('accepts heartbeat, monotonic update and supported telemetry atomically',async()=>{
    expect(await service.processHeartbeat(event())).toEqual({accepted:true,deviceId:'42',lastSeenAt:now});
    expect(state.connectionStatus).toBe('online');expect(state.samples).toHaveLength(1);
    expect(ownership.validateAuthorizedDevice).toHaveBeenCalledWith(tx.ownership,'robot',credential,404);
  });
  it('rejects invalid device/proof and unapproved contract without mutation',async()=>{
    ownership.validateAuthorizedDevice.mockRejectedValue(new UnauthorizedException());
    await expect(service.processHeartbeat(event())).rejects.toMatchObject({status:401});expect(state.lastSeenAt).toBeNull();
    config.set('DEVICE_AUTH_CONTRACT_APPROVED','false');await expect(service.processHeartbeat(event())).rejects.toMatchObject({status:403});
  });
  it('ignores duplicate/out-of-order events and avoids duplicate samples',async()=>{
    await service.processHeartbeat(event());
    for(const time of ['2026-10-30T01:00:00Z','2026-10-30T00:59:59Z'])expect(await service.processHeartbeat(event(time))).toMatchObject({accepted:false,reason:'STALE_OR_DUPLICATE'});
    expect(state.samples).toHaveLength(1);expect(state.lastSeenAt).toEqual(now);
  });
  it('drops delayed event at timeout boundary and rejects future event',async()=>{
    expect(await service.processHeartbeat(event('2026-10-30T00:59:00Z'))).toMatchObject({accepted:false});
    await expect(service.processHeartbeat(event('2026-10-30T01:00:01Z'))).rejects.toMatchObject({status:409});
    expect(tx.updateDevicePresence).not.toHaveBeenCalled();
  });
  it('timeout marks OFFLINE without changing assignment; fresh reconnect marks ONLINE',async()=>{
    const assignment=structuredClone(state.assignment);state.lastSeenAt=new Date(now.getTime()-60000);state.connectionStatus='online';
    const result=await service.getDeviceMonitoring({userId:'7',role:'USER'},'42');
    expect(result.connectionStatus).toBe('offline');expect(state.assignment).toEqual(assignment);
    expect(ownership.verifyOwnershipInTransaction).toHaveBeenCalledWith(tx.ownership,'7','42');
    await service.processHeartbeat(event());expect(state.connectionStatus).toBe('online');expect(state.assignment).toEqual(assignment);
  });
  it('Admin can monitor unassigned/blocked device, User scope remains enforced',async()=>{
    expect(await service.getDeviceMonitoring({userId:'1',role:'ADMIN'},'42')).toMatchObject({deviceId:'42',connectionStatus:'offline'});
    ownership.verifyOwnershipInTransaction.mockRejectedValue(new ForbiddenException());
    await expect(service.getDeviceMonitoring({userId:'8',role:'USER'},'42')).rejects.toMatchObject({status:403});
  });
  it('rolls back lastSeen and status if telemetry insertion fails',async()=>{
    tx.saveDeviceTelemetry.mockRejectedValue(new Error('SQL details'));
    await expect(service.processHeartbeat(event())).rejects.toMatchObject({status:500,message:'MONITORING_UNAVAILABLE'});
    expect(state.lastSeenAt).toBeNull();expect(state.connectionStatus).toBe('offline');
  });
  it('concurrent duplicate heartbeats create one sample in transaction model',async()=>{
    const results=await Promise.all([service.processHeartbeat(event()),service.processHeartbeat(event())]);
    expect(results.filter(r=>r.accepted)).toHaveLength(1);expect(state.samples).toHaveLength(1);
  });
  it.each(['heartbeat-first','timeout-first'])('heartbeat/timeout %s keeps fresh reconnect online in model',async order=>{
    state.lastSeenAt=new Date(now.getTime()-60000);state.connectionStatus='online';
    const heartbeat=()=>service.processHeartbeat(event());const timeout=()=>service.getDeviceMonitoring({userId:'7',role:'USER'},'42');
    await Promise.all(order==='heartbeat-first'?[heartbeat(),timeout()]:[timeout(),heartbeat()]);
    expect(state.connectionStatus).toBe('online');expect(state.lastSeenAt).toEqual(now);
  });
  it('uses approved timeout default and maps deadlock to retry',async()=>{
    expect(new MonitoringService(repository,ownership,new ConfigService()).timeoutSeconds()).toBe(60);
    repository.transaction.mockRejectedValue({code:'ER_LOCK_DEADLOCK'});
    await expect(service.processHeartbeat(event())).rejects.toMatchObject({status:409});
  });
});

describe('MonitoringRepository persistence and cleanup',()=>{
  let c:any;let repo:MonitoringRepository;let tx:MonitoringTransaction;
  beforeEach(()=>{c={execute:jest.fn().mockResolvedValue([[]]),query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    const pool={execute:c.execute,getConnection:jest.fn().mockResolvedValue(c)};repo=new MonitoringRepository(pool as never);tx=new MonitoringTransaction(pool as never,c);});
  it('conditionally updates only presence; no assignment or lifecycle DML',async()=>{
    await tx.updateDevicePresence('42',now);await tx.markDeviceOffline('42',now,60);await repo.markExpiredDevicesOffline(60);
    const statements=c.execute.mock.calls.map((call:any[])=>call[0]).join('\n');
    expect(statements).not.toMatch(/device_assignments|lifecycle_status/);expect(statements).toContain('last_seen_at<?');
    expect(statements).toContain('last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND)');
    // Never classify a heartbeat committed while the sweep was waiting as 'future'.
    expect(c.execute.mock.calls[2][0]).not.toContain('last_seen_at>UTC_TIMESTAMP()');
  });
  it('inserts one bounded sample only when telemetry exists; timestamp bound',async()=>{
    await tx.saveDeviceTelemetry('42',heartbeatInput({...event(),telemetry:undefined}));expect(c.execute).not.toHaveBeenCalled();
    await tx.saveDeviceTelemetry('42',heartbeatInput(event()));
    expect(c.execute.mock.calls[0][1]).toEqual(['42',-65,'123456',85,null,now]);
    expect(c.execute.mock.calls[0][0]).toContain("VALUES(?,'heartbeat',?,?,?,?,?)");
  });
  it('reads latest sample by existing device/time index and projects no payload',async()=>{
    expect(await tx.telemetry('42')).toEqual({wifiRssi:null,freeHeapBytes:null,batteryPercent:null});
    const [sql,values]=c.execute.mock.calls[0];expect(values).toEqual(['42']);expect(sql).toContain('ORDER BY recorded_at DESC,id DESC LIMIT 1');
    expect(sql.split('FROM')[0]).not.toContain('payload');
  });
  it('commits success, rolls back work/commit failure and always releases',async()=>{
    await repo.transaction(async()=>true);expect(c.commit).toHaveBeenCalled();
    await expect(repo.transaction(async()=>{throw new Error('insert failed');})).rejects.toThrow('insert failed');
    c.commit.mockRejectedValue(new Error('commit failed'));await expect(repo.transaction(async()=>true)).rejects.toThrow('commit failed');
    expect(c.rollback).toHaveBeenCalledTimes(2);expect(c.release).toHaveBeenCalledTimes(3);
  });
});

describe('PresenceSweeper lifecycle',()=>{
  afterEach(()=>jest.useRealTimers());
  it('runs every approved timeout, never overlaps and stops on shutdown',async()=>{
    jest.useFakeTimers();let release!:()=>void;
    const service={timeoutSeconds:()=>60,markExpiredDevicesOffline:jest.fn(()=>new Promise<void>(r=>release=r))};
    const sweeper=new PresenceSweeper(service as unknown as MonitoringService,new ConfigService());sweeper.onApplicationBootstrap();
    jest.advanceTimersByTime(60000);expect(service.markExpiredDevicesOffline).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60000);expect(service.markExpiredDevicesOffline).toHaveBeenCalledTimes(1);
    release();await sweeper.onApplicationShutdown();jest.advanceTimersByTime(60000);expect(service.markExpiredDevicesOffline).toHaveBeenCalledTimes(1);
  });
  it('can be explicitly disabled without a background writer',()=>{
    jest.useFakeTimers();const service={timeoutSeconds:()=>60,markExpiredDevicesOffline:jest.fn()};
    new PresenceSweeper(service as unknown as MonitoringService,new ConfigService({HEARTBEAT_SWEEPER_ENABLED:'false'})).onApplicationBootstrap();
    jest.advanceTimersByTime(120000);expect(service.markExpiredDevicesOffline).not.toHaveBeenCalled();
  });
});
