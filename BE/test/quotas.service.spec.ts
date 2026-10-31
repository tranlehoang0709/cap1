import { ConfigService } from '@nestjs/config';
import { ConflictException,ForbiddenException } from '@nestjs/common';
import { QuotasService } from '../src/modules/quotas/quotas.service';
import { QuotaPolicy,UsageRow } from '../src/modules/quotas/quotas.types';
import { admissionInput,policyInput,policyMode,reportInput,statisticsInput } from '../src/modules/quotas/dto/quota.dto';
import { UsageReportSweeper } from '../src/modules/quotas/usage-report-sweeper';

const user={userId:'7',role:'USER' as const},admin={userId:'1',role:'ADMIN' as const};
const start=new Date('2026-10-30T01:00:00Z');
const request=(n=1)=>({requestId:`request_test_${String(n).padStart(8,'0')}`,userId:'7',providerId:'2',modelId:'3',maxTotalTokens:'10'});
const report=(n=1)=>({requestId:request(n).requestId,providerId:'2',status:'success',inputTokens:2,outputTokens:3,durationMs:100});
const initial:QuotaPolicy={id:'1',userId:'7',providerId:'2',requestsPerMinute:3,requestsPerDay:10,tokensPerMonth:'100'};

describe('QuotasService with durable transaction state model (not MySQL engine proof)',()=>{
  let service:QuotasService,config:ConfigService;let state:any,repository:any,tx:any,providers:any;
  const copy=(value:any)=>structuredClone(value);
  beforeEach(()=>{
    state={now:start,policies:[copy(initial)],records:[] as UsageRow[],audits:[],active:true,profileScope:'USER'};
    config=new ConfigService({AI_QUOTA_CONTRACT_APPROVED:'true',AI_USAGE_REPORT_TIMEOUT_SECONDS:'30'});
    const totals=()=>{
      const minute=state.now.getTime()-60000,day=Date.UTC(state.now.getUTCFullYear(),state.now.getUTCMonth(),state.now.getUTCDate()),month=Date.UTC(state.now.getUTCFullYear(),state.now.getUTCMonth(),1);
      const rows=state.records.filter((r:UsageRow)=>r.userId==='7'&&r.providerId==='2');const pending=(r:UsageRow)=>!r.finalizedAt;
      return {minuteRequests:String(rows.filter((r:UsageRow)=>r.occurredAt.getTime()>minute&&r.occurredAt<=state.now).length),
        dayRequests:String(rows.filter((r:UsageRow)=>r.occurredAt.getTime()>=day&&r.occurredAt<=state.now).length),
        monthTokens:rows.filter((r:UsageRow)=>r.occurredAt.getTime()>=month&&!pending(r)).reduce((sum:bigint,r:any)=>sum+BigInt(r.inputTokens)+BigInt(r.outputTokens),0n).toString(),
        reservedTokens:rows.filter((r:UsageRow)=>r.occurredAt.getTime()>=month&&pending(r)).reduce((sum:bigint,r:UsageRow)=>sum+BigInt(r.reservedTokens??'0'),0n).toString(),
        unboundedRequests:String(rows.filter((r:UsageRow)=>pending(r)&&r.reservedTokens===null).length)};
    };
    tx={ai:{users:{findByIdForUpdate:jest.fn(async(id:string)=>({id,status:state.active||id==='1'?'active':'disabled',email_verified_at:start})),
      findUserRoles:jest.fn(async(id:string)=>[{code:id==='1'?'ADMIN':'USER'}])},provider:jest.fn(async()=>({id:'2',code:'LOCAL',isEnabled:1})),
      ownership:{devices:{findDeviceById:jest.fn(async()=>({id:'42'}))},verifyDeviceOwnership:jest.fn(async()=>({id:'42'}))}},
      now:jest.fn(async()=>state.now),policies:jest.fn(async()=>copy(state.policies)),totals:jest.fn(async()=>totals()),
      context:jest.fn(async(i:any)=>i.conversationId),request:jest.fn(async(id:string)=>copy(state.records.find((r:UsageRow)=>r.requestId===id)??null)),
      admit:jest.fn(async(i:any,hash:string,policyId:string,credentialId:string|null,conversationId:string|null,now:Date,due:Date)=>{
        if(state.records.some((r:UsageRow)=>r.requestId===i.requestId))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});
        state.records.push({id:String(state.records.length+1),userId:i.userId,providerId:i.providerId,modelId:i.modelId,conversationId,sessionId:i.sessionId,
          credentialId,requestId:i.requestId,fingerprint:hash,policyId,reservedTokens:i.maxTotalTokens,status:'admitted',occurredAt:now,reportDueAt:due,
          reportFingerprint:null,finalizedAt:null,inputTokens:null,outputTokens:null,durationMs:null});}),
      finalize:jest.fn(async(row:UsageRow,u:any,hash:string,now:Date)=>Object.assign(state.records.find((r:UsageRow)=>r.id===row.id),u,{reportFingerprint:hash,finalizedAt:now})),
      markMissing:jest.fn(async(row:UsageRow)=>{state.records.find((r:UsageRow)=>r.id===row.id).status='report_missing';}),
      audit:jest.fn(async(...args:any[])=>{state.audits.push(args);}),
      replacePolicy:jest.fn(async(userId:string,providerId:string,limits:any)=>{const id=String(Number(state.policies[0]?.id??0)+1);state.policies=[{id,userId,providerId,
        requestsPerMinute:limits.requestsPerMinute,requestsPerDay:limits.requestsPerDay,tokensPerMonth:limits.tokensPerMonth}];return id;}),
      statistics:jest.fn(async(userId:string|null,providerId:string|null,from:Date,to:Date)=>{
        const rows=state.records.filter((r:UsageRow)=>(!userId||r.userId===userId)&&(!providerId||r.providerId===providerId)&&r.occurredAt>=from&&r.occurredAt<to);
        return {requestsUsed:String(rows.length),inputTokens:rows.reduce((s:bigint,r:any)=>s+BigInt(r.inputTokens??0),0n).toString(),
          outputTokens:rows.reduce((s:bigint,r:any)=>s+BigInt(r.outputTokens??0),0n).toString(),reservedTokens:totals().reservedTokens,unboundedRequests:totals().unboundedRequests};})};
    let tail=Promise.resolve();repository={assertSchema:jest.fn(),transaction:jest.fn(async(work:any)=>{
      const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;const before=copy(state);
      try{return await work(tx);}catch(error){state=before;throw error;}finally{release();}}),
      overdueRequestIds:jest.fn(async()=>state.records.filter((r:UsageRow)=>r.status==='admitted'&&!r.finalizedAt&&r.reportDueAt&&r.reportDueAt<=state.now).map((r:UsageRow)=>r.requestId))};
    providers={checkProviderPermission:jest.fn(async()=>({provider:{id:'2'},model:{id:'3'},credentialScope:'NONE',credentialReference:null}))};
    service=new QuotasService(repository,providers,config);
  });
  it('admits once with a committed reservation and null actuals; logs no secret or prompt',async()=>{
    const result=await service.authorizeAIRequest(request());expect(result).toMatchObject({allowed:true,executionAllowed:true,reservedTokens:'10',remainingQuota:{requestsPerMinute:'2',requestsPerDay:'9',tokensPerMonth:'90'}});
    expect(state.records[0]).toMatchObject({inputTokens:null,outputTokens:null,reservedTokens:'10',status:'admitted'});
    expect(state.audits[0][1]).toBe('AI_REQUEST_ADMITTED');expect(JSON.stringify(state.audits)).not.toMatch(/cipher|secret|prompt/);
    expect(tx.ai.users.findByIdForUpdate.mock.invocationCallOrder[0]).toBeLessThan(tx.totals.mock.invocationCallOrder[0]);
    expect(tx.totals.mock.invocationCallOrder[0]).toBeLessThan(tx.admit.mock.invocationCallOrder[0]);
  });
  it('UNLIMITED bypasses quotas while retaining authentication and usage logging',async()=>{
    state.policies=[{...initial,requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null}];
    const {maxTotalTokens,...input}=request();expect(await service.authorizeAIRequest(input)).toMatchObject({allowed:true,mode:'UNLIMITED',remainingQuota:{requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null}});
    expect(state.records).toHaveLength(1);expect(state.records[0].reservedTokens).toBeNull();
    state.active=false;await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:403});expect(state.records).toHaveLength(1);
  });
  it.each(['credential','provider','model'])('UNLIMITED still rejects unavailable %s',async()=>{
    state.policies=[{...initial,requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null}];providers.checkProviderPermission.mockRejectedValue(new ForbiddenException('PROVIDER_OR_CREDENTIAL_UNAVAILABLE'));
    await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:403});expect(tx.admit).not.toHaveBeenCalled();
    expect(state.audits[0][1]).toBe('AI_REQUEST_DENIED');
  });
  it.each(['missing','duplicate','blocked','invalid'])('fails closed for %s policy',async kind=>{
    if(kind==='missing')state.policies=[];if(kind==='duplicate')state.policies=[initial,{...initial,id:'2'}];
    if(kind==='blocked')state.policies=[{...initial,requestsPerMinute:0,requestsPerDay:0,tokensPerMonth:'0'}];
    if(kind==='invalid')state.policies=[{...initial,requestsPerMinute:0}];
    await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:['duplicate','invalid'].includes(kind)?409:403});expect(state.records).toHaveLength(0);
    expect(state.audits).toHaveLength(1);
  });
  it('finite tokens require a reservation; reservation can exhaust budget before final report',async()=>{
    const {maxTotalTokens,...input}=request();await expect(service.authorizeAIRequest(input)).rejects.toMatchObject({status:400});
    await service.authorizeAIRequest({...request(),maxTotalTokens:'100'});
    await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:429});expect(state.records).toHaveLength(1);
  });
  it('concurrent admissions cannot exceed minute/day or reserved token limits in the transaction model',async()=>{
    state.policies[0].tokensPerMonth='25';
    const results=await Promise.allSettled(Array.from({length:10},(_,n)=>service.authorizeAIRequest(request(n+1))));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);expect(state.records).toHaveLength(2);
    expect(results.filter(r=>r.status==='rejected').every((r:any)=>r.reason.status===429)).toBe(true);
  });
  it('identical concurrent request IDs create one row and replay state without execution permission',async()=>{
    const results=await Promise.all([service.authorizeAIRequest(request()),service.authorizeAIRequest(request())]);
    expect(results.filter((r:any)=>r.allowed)).toHaveLength(1);expect(results[1]).toMatchObject({allowed:false,replayed:true,executionAllowed:false,state:'ADMITTED'});
    expect(tx.admit).toHaveBeenCalledTimes(1);expect(state.audits).toHaveLength(1);
    await expect(service.authorizeAIRequest({...request(),maxTotalTokens:'11'})).rejects.toMatchObject({status:409});
    await expect(service.authorizeAIRequest({...request(),userId:'8'})).rejects.toMatchObject({status:409});expect(state.records).toHaveLength(1);
  });
  it.each(['failed','cancelled','success'])('final %s records actuals, releases unused hold, and never refunds request count',async status=>{
    await service.authorizeAIRequest(request());expect(await service.recordAIUsage({...report(),status})).toMatchObject({recorded:true,replayed:false,status:status.toUpperCase()});
    expect(state.records).toHaveLength(1);expect(state.records[0]).toMatchObject({inputTokens:2,outputTokens:3,status,reservedTokens:'10'});
    expect(await tx.totals()).toMatchObject({minuteRequests:'1',monthTokens:'5',reservedTokens:'0'});
    const replay=await service.authorizeAIRequest(request());expect(replay).toMatchObject({allowed:false,replayed:true,reason:'REQUEST_FINALIZED'});
  });
  it('duplicate reports including concurrent retries charge once, conflicting reports cannot overwrite',async()=>{
    await service.authorizeAIRequest(request());const results=await Promise.all([service.recordAIUsage(report()),service.recordAIUsage({...report(),status:'SUCCESS'})]);
    expect(results.map(r=>r.replayed)).toEqual([false,true]);expect(tx.finalize).toHaveBeenCalledTimes(1);
    await expect(service.recordAIUsage({...report(),outputTokens:4})).rejects.toMatchObject({status:409});expect(state.records[0].outputTokens).toBe(3);
    await expect(service.recordAIUsage({...report(),providerId:'4'})).rejects.toMatchObject({status:409});
    await expect(service.recordAIUsage(report(9))).rejects.toMatchObject({status:404});
  });
  it('missing report retains holds, crash replay cannot execute again, late report settles once',async()=>{
    await service.authorizeAIRequest(request());state.now=new Date(start.getTime()+30000);
    expect(await service.markMissingReports()).toEqual({marked:1});expect(await service.markMissingReports()).toEqual({marked:0});
    expect(state.records[0].status).toBe('report_missing');expect((await tx.totals()).reservedTokens).toBe('10');
    expect(await service.authorizeAIRequest(request())).toMatchObject({allowed:false,reason:'USAGE_REPORT_MISSING'});
    await service.recordAIUsage(report());expect((await tx.totals()).reservedTokens).toBe('0');expect((await tx.totals()).monthTokens).toBe('5');
  });
  it('retry itself detects an overdue report even if worker is disabled',async()=>{
    await service.authorizeAIRequest(request());state.now=new Date(start.getTime()+30000);
    expect(await service.authorizeAIRequest(request())).toMatchObject({reason:'USAGE_REPORT_MISSING'});expect(tx.markMissing).toHaveBeenCalledTimes(1);
  });
  it('settles actual usage after account/device/key revoke and after admission contract is disabled',async()=>{
    await service.authorizeAIRequest(request());state.active=false;config.set('AI_QUOTA_CONTRACT_APPROVED','false');
    expect(await service.recordAIUsage(report())).toMatchObject({recorded:true});expect(providers.checkProviderPermission).toHaveBeenCalledTimes(1);
  });
  it('overrun records truth and audit, recomputes availability without silently dropping actual tokens',async()=>{
    state.policies[0].tokensPerMonth='10';await service.authorizeAIRequest(request());
    expect(await service.recordAIUsage({...report(),inputTokens:6,outputTokens:8})).toMatchObject({recorded:true,budgetExceeded:true});
    expect((await tx.totals()).monthTokens).toBe('14');expect(state.audits.some((a:any[])=>a[1]==='AI_TOKEN_BUDGET_EXCEEDED')).toBe(true);
    await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:429});
  });
  it('minute boundary rolls over at exactly 60 seconds; a failed request still counts in the day',async()=>{
    state.policies[0]={...initial,requestsPerMinute:1,requestsPerDay:1};await service.authorizeAIRequest(request());await service.recordAIUsage({...report(),status:'failed',inputTokens:0,outputTokens:0});
    state.now=new Date(start.getTime()+60000);expect((await tx.totals()).minuteRequests).toBe('0');
    await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:429});
    state.now=new Date('2026-10-31T00:00:00Z');expect(await service.authorizeAIRequest(request(2))).toMatchObject({allowed:true});
  });
  it('month rollover charges a late report to its admission month',async()=>{
    state.now=new Date('2026-10-31T23:59:59Z');state.policies[0]={...initial,requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:'10'};
    await service.authorizeAIRequest(request());state.now=new Date('2026-11-01T00:00:00Z');await service.recordAIUsage(report());
    expect(state.records[0].occurredAt).toEqual(new Date('2026-10-31T23:59:59Z'));expect((await tx.totals()).monthTokens).toBe('0');
    expect(await service.authorizeAIRequest(request(2))).toMatchObject({allowed:true,remainingQuota:{tokensPerMonth:'0'}});
  });
  it('Admin versions policy atomically, uses expectedPolicyId and never resets usage',async()=>{
    await service.authorizeAIRequest(request());
    expect(await service.updateQuotaPolicy(admin,'7','2',{mode:'BLOCKED',expectedPolicyId:'1'})).toMatchObject({mode:'BLOCKED',requestsPerMinute:0,tokensPerMonth:'0'});
    expect(state.records).toHaveLength(1);expect(state.audits.at(-1)[1]).toBe('AI_QUOTA_POLICY_CHANGED');
    await expect(service.updateQuotaPolicy(admin,'7','2',{mode:'UNLIMITED',expectedPolicyId:'1'})).rejects.toMatchObject({status:409});
    await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:403});
    expect(await service.updateQuotaPolicy(admin,'7','2',{mode:'UNLIMITED',expectedPolicyId:'2'})).toMatchObject({mode:'UNLIMITED'});
    expect(state.records).toHaveLength(1);
  });
  it.each(['configure-first','admit-first'])('concurrent BLOCKED configuration vs admission: %s preserves serialized order',async order=>{
    const update=()=>service.updateQuotaPolicy(admin,'7','2',{mode:'BLOCKED',expectedPolicyId:'1'});
    const admit=()=>service.authorizeAIRequest(request());
    const results=await Promise.allSettled(order==='configure-first'?[update(),admit()]:[admit(),update()]);
    expect(state.records).toHaveLength(order==='configure-first'?0:1);expect(state.policies[0].requestsPerMinute).toBe(0);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(order==='configure-first'?1:0);
  });
  it('Admin cannot enable finite tokens with unbounded pending requests; settlement permits transition',async()=>{
    state.policies=[{...initial,requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null}];const {maxTotalTokens,...input}=request();await service.authorizeAIRequest(input);
    const patch={mode:'LIMITED',expectedPolicyId:'1',requestsPerMinute:10,requestsPerDay:null,tokensPerMonth:'100'};
    await expect(service.updateQuotaPolicy(admin,'7','2',patch)).rejects.toMatchObject({status:409,message:'UNBOUNDED_REQUESTS_IN_FLIGHT'});
    await service.recordAIUsage(report());expect(await service.updateQuotaPolicy(admin,'7','2',patch)).toMatchObject({mode:'LIMITED'});
  });
  it('lowering limits below used+held blocks only new work, does not erase existing reservations',async()=>{
    await service.authorizeAIRequest(request());await service.updateQuotaPolicy(admin,'7','2',{mode:'LIMITED',expectedPolicyId:'1',requestsPerMinute:1,requestsPerDay:1,tokensPerMonth:'5'});
    await expect(service.authorizeAIRequest(request(2))).rejects.toMatchObject({status:429});expect(state.records[0].reservedTokens).toBe('10');
    expect(await service.recordAIUsage(report())).toMatchObject({recorded:true});
  });
  it('supports first Admin policy creation, reports missing/duplicate configuration and enforces roles',async()=>{
    state.policies=[];expect(await service.getQuotaPolicy(admin,'7','2')).toMatchObject({policyStatus:'MISSING',policyId:null});
    expect(await service.updateQuotaPolicy(admin,'7','2',{mode:'UNLIMITED',expectedPolicyId:null})).toMatchObject({mode:'UNLIMITED'});
    await expect(service.updateQuotaPolicy(user,'7','2',{mode:'BLOCKED',expectedPolicyId:'1'})).rejects.toMatchObject({status:403});
    state.policies=[initial,{...initial,id:'2'}];await expect(service.getQuotaPolicy(admin,'7','2')).rejects.toMatchObject({status:409});
    await expect(service.updateQuotaPolicy(admin,'7','2',{mode:'BLOCKED',expectedPolicyId:'1'})).rejects.toMatchObject({status:409});
  });
  it('User statistics cannot select another User; Admin broad stats do not invent aggregate quota limits',async()=>{
    await service.authorizeAIRequest(request());await service.recordAIUsage(report());
    expect(await service.getUsageStatistics(user,{providerId:'2'})).toMatchObject({requestsUsed:'1',inputTokens:'2',outputTokens:'3',reservedTokens:'0',mode:'LIMITED'});
    expect(tx.statistics).toHaveBeenLastCalledWith('7','2',expect.any(Date),expect.any(Date));
    await expect(service.getUsageStatistics(user,{userId:'8'})).rejects.toMatchObject({status:400});
    expect(await service.getUsageStatistics(admin,{})).toMatchObject({policyStatus:'NOT_SCOPED',quotaLimit:null,remainingQuota:null});
  });
  it('does not advertise an available token balance when a finite legacy policy has an unknown hold',async()=>{
    tx.totals.mockResolvedValue({minuteRequests:'1',dayRequests:'1',monthTokens:'0',reservedTokens:'0',unboundedRequests:'1'});
    expect(await service.getUsageStatistics(user,{providerId:'2'})).toMatchObject({mode:'LIMITED',remainingQuota:{tokensPerMonth:null},admissionBlockedByUnboundedRequests:true,quotaUnboundedRequests:'1'});
    state.policies=[{...initial,requestsPerMinute:0,requestsPerDay:0,tokensPerMonth:'0'}];
    expect(await service.getUsageStatistics(user,{providerId:'2'})).toMatchObject({mode:'BLOCKED',remainingQuota:{tokensPerMonth:'0'},admissionBlockedByUnboundedRequests:false});
  });
  it('validates device/conversation context and delegates permissions on same transaction',async()=>{
    tx.ai.ownership.verifyDeviceOwnership.mockResolvedValue(null);
    await expect(service.authorizeAIRequest({...request(),deviceId:'42'})).rejects.toMatchObject({status:403});
    expect(tx.admit).not.toHaveBeenCalled();tx.ai.ownership.verifyDeviceOwnership.mockResolvedValue({id:'42'});tx.context.mockRejectedValue(new ConflictException('INVALID_AI_CONTEXT'));
    await expect(service.authorizeAIRequest({...request(),deviceId:'42',sessionId:'12'})).rejects.toMatchObject({status:409});
  });
  it('rolls back admission, finalization and policy updates when auditing fails',async()=>{
    tx.audit.mockRejectedValueOnce(new Error('audit failed'));await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:500});expect(state.records).toHaveLength(0);
    await service.authorizeAIRequest(request());tx.audit.mockRejectedValueOnce(new ConflictException('audit failed'));
    await expect(service.recordAIUsage(report())).rejects.toMatchObject({status:409});expect(state.records[0].finalizedAt).toBeNull();
    tx.audit.mockRejectedValueOnce(new Error('audit failed'));await expect(service.updateQuotaPolicy(admin,'7','2',{mode:'BLOCKED',expectedPolicyId:'1'})).rejects.toMatchObject({status:500});expect(state.policies[0].id).toBe('1');
  });
  it('never commits an admission if a post-write audit raises an HTTP exception',async()=>{
    tx.audit.mockRejectedValueOnce(new ConflictException('audit unavailable'));await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:409});expect(state.records).toHaveLength(0);
  });
  it('fails closed for absent migration/deadline/contract and maps DB conflicts without secrets',async()=>{
    config.set('AI_QUOTA_CONTRACT_APPROVED','false');await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:403});
    config.set('AI_QUOTA_CONTRACT_APPROVED','true');config.set('AI_USAGE_REPORT_TIMEOUT_SECONDS','');await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:409});
    config.set('AI_USAGE_REPORT_TIMEOUT_SECONDS','30');repository.assertSchema.mockRejectedValueOnce(new ConflictException('QUOTA_SCHEMA_NOT_READY'));
    await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:409});expect(tx.admit).not.toHaveBeenCalled();
    repository.transaction.mockRejectedValueOnce({code:'ER_DUP_ENTRY'});await expect(service.authorizeAIRequest(request())).rejects.toMatchObject({status:409,message:'QUOTA_REQUEST_CONFLICT'});
  });
});

describe('Quota DTO and mode boundaries',()=>{
  it.each([{mode:'UNLIMITED',expectedPolicyId:null},{mode:'BLOCKED',expectedPolicyId:'1'},
    {mode:'LIMITED',expectedPolicyId:null,requestsPerMinute:1,requestsPerDay:null,tokensPerMonth:'1'}])('accepts %j',input=>expect(policyMode({...policyInput(input)})).toBe(input.mode));
  it.each([{mode:'UNLIMITED',expectedPolicyId:null,tokensPerMonth:'0'},{mode:'LIMITED',expectedPolicyId:null,requestsPerMinute:1},
    {mode:'LIMITED',expectedPolicyId:null,requestsPerMinute:0,requestsPerDay:null,tokensPerMonth:null},
    {mode:'LIMITED',expectedPolicyId:null,requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null},{mode:'BLOCKED'},
    {mode:'LIMITED',expectedPolicyId:null,requestsPerMinute:1,requestsPerDay:1,tokensPerMonth:'9223372036854775808'}])('rejects %j',input=>expect(()=>policyInput(input)).toThrow());
  it.each([{...request(),requestId:'short'},{...request(),maxTotalTokens:10},{...request(),maxTotalTokens:'-1'},
    {...request(),userId:'0'},{...request(),secret:'no-secrets'}])('rejects admission %j',input=>expect(()=>admissionInput(input)).toThrow());
  it.each([{...report(),inputTokens:-1},{...report(),outputTokens:0.5},{...report(),durationMs:2147483648},{...report(),status:'unknown'},{...report(),userId:'8'}])('rejects report %j',input=>expect(()=>reportInput(input)).toThrow());
  it('rejects invalid date ranges/arrays and unknown User scope',()=>{
    for(const query of [{from:'bad',to:'bad'},{from:'2026-02-30T00:00:00.000Z',to:'2026-03-01T00:00:00.000Z'},
      {from:'2026-10-30T00:00:00.000Z'},{providerId:['1','2']},{userId:'8'}])expect(()=>statisticsInput(query,false)).toThrow();
  });
});

describe('Usage report sweeper lifecycle',()=>{
  afterEach(()=>jest.useRealTimers());
  it('is disabled by default and requires a configured interval when enabled',()=>{
    jest.useFakeTimers();const service={reportTimeoutSeconds:jest.fn(()=>{throw new ConflictException('missing');}),markMissingReports:jest.fn()};
    new UsageReportSweeper(service as any,new ConfigService()).onApplicationBootstrap();expect(service.reportTimeoutSeconds).not.toHaveBeenCalled();
    expect(()=>new UsageReportSweeper(service as any,new ConfigService({AI_USAGE_REPORT_SWEEPER_ENABLED:'true'})).onApplicationBootstrap()).toThrow();
  });
  it('does not overlap and stops on shutdown, without releasing any reservation',async()=>{
    jest.useFakeTimers();let release!:(v:unknown)=>void;const service={reportTimeoutSeconds:()=>30,markMissingReports:jest.fn(()=>new Promise(r=>release=r))};
    const worker=new UsageReportSweeper(service as any,new ConfigService({AI_USAGE_REPORT_SWEEPER_ENABLED:'true'}));worker.onApplicationBootstrap();
    jest.advanceTimersByTime(60000);expect(service.markMissingReports).toHaveBeenCalledTimes(1);release({marked:1});await worker.onApplicationShutdown();
    jest.advanceTimersByTime(60000);expect(service.markMissingReports).toHaveBeenCalledTimes(1);
  });
});
