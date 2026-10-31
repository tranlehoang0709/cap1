import { QuotasRepository,QuotaTransaction } from '../src/modules/quotas/quotas.repository';
import { admissionInput } from '../src/modules/quotas/dto/quota.dto';
const now=new Date('2026-11-01T00:00:00Z');
const input=admissionInput({requestId:'request_repository_001',userId:'7',providerId:'2',modelId:'3',maxTotalTokens:'10'});
const row={id:'9',requestId:input.requestId,userId:'7',providerId:'2',reservedTokens:'10'} as any;

describe('Quota schema readiness and repository transactions',()=>{
  let c:any,pool:any,repository:QuotasRepository,tx:QuotaTransaction;
  beforeEach(()=>{c={execute:jest.fn().mockResolvedValue([[]]),query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    pool={execute:c.execute,getConnection:jest.fn().mockResolvedValue(c)};repository=new QuotasRepository(pool);tx=new QuotaTransaction(pool,c);});
  function columns(){return ['request_id','request_fingerprint','quota_policy_id','reserved_tokens','report_due_at','report_fingerprint','finalized_at'].map(name=>
    ({name,type:name==='request_id'?'varchar':name.endsWith('fingerprint')?'char':['quota_policy_id','reserved_tokens'].includes(name)?'bigint':'datetime',collation:name==='request_id'?'ascii_bin':null}));}
  function ready(index:unknown={name:'uq_request',columnsList:'request_id',nonUnique:0,prefixes:0},foreignKey:unknown[]=[{name:'quota_policy_id'}]){
    c.execute.mockResolvedValueOnce([columns()]).mockResolvedValueOnce([[index]]).mockResolvedValueOnce([foreignKey]);
  }
  it('fails closed before any transaction/write when new fields are absent',async()=>{
    await expect(repository.assertSchema()).rejects.toMatchObject({status:409,message:'QUOTA_SCHEMA_NOT_READY'});
    expect(pool.getConnection).not.toHaveBeenCalled();expect(c.execute.mock.calls.every((call:any[])=>call[0].startsWith('SELECT'))).toBe(true);
  });
  it('requires full case-sensitive globally unique ID and matching policy FK',async()=>{
    ready();await expect(repository.assertSchema()).resolves.toBeUndefined();
    ready({columnsList:'request_id',nonUnique:1,prefixes:0});await expect(repository.assertSchema()).rejects.toMatchObject({status:409});
    ready({columnsList:'request_id,user_id',nonUnique:0,prefixes:0});await expect(repository.assertSchema()).rejects.toMatchObject({status:409});
    ready({columnsList:'request_id',nonUnique:0,prefixes:1});await expect(repository.assertSchema()).rejects.toMatchObject({status:409});
    ready(undefined,[]);await expect(repository.assertSchema()).rejects.toMatchObject({status:409});
  });
  it('rejects case-insensitive or wrongly typed request columns',async()=>{
    const data=columns();data[0].collation='ascii_general_ci';c.execute.mockResolvedValueOnce([data]);await expect(repository.assertSchema()).rejects.toMatchObject({status:409});
  });
  it('uses READ COMMITTED, commits success, rolls back work/commit failure and releases',async()=>{
    await repository.transaction(async()=>true);expect(c.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');expect(c.commit).toHaveBeenCalledTimes(1);
    await expect(repository.transaction(async()=>{throw new Error('write failed');})).rejects.toThrow('write failed');
    c.commit.mockRejectedValue(new Error('commit failed'));await expect(repository.transaction(async()=>true)).rejects.toThrow('commit failed');
    expect(c.rollback).toHaveBeenCalledTimes(2);expect(c.release).toHaveBeenCalledTimes(3);
  });
  it('reports rollback failure without silently treating work as committed',async()=>{
    c.rollback.mockRejectedValue(new Error('rollback failed'));await expect(repository.transaction(async()=>{throw new Error('work failed');})).rejects.toBeInstanceOf(AggregateError);expect(c.release).toHaveBeenCalled();
  });
  it('uses exact active User+Provider policies and keeps prior versions',async()=>{
    await tx.policies('7','2');expect(c.execute.mock.calls[0][0]).toContain('WHERE user_id=? AND provider_id=? AND is_active=1');expect(c.execute.mock.calls[0][0]).toContain('FOR UPDATE');expect(c.execute.mock.calls[0][1]).toEqual(['7','2']);
    c.execute.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{id:'9007199254740993'}]]);
    expect(await tx.replacePolicy('7','2',{requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null},now)).toBe('9007199254740993');
    expect(c.execute.mock.calls[1][0]).toContain('SET is_active=0');expect(c.execute.mock.calls[2][0]).toContain('INSERT INTO quota_policies');
    expect(c.execute.mock.calls.some((call:any[])=>/DELETE/.test(call[0]))).toBe(false);
  });
  it('reserves one row, never writes fake actual tokens, and does not use system_settings',async()=>{
    await tx.admit(input,'hash','1',null,null,now,new Date(now.getTime()+30000));const [sql,values]=c.execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO usage_records');expect(sql).toContain("'LLM',NULL,NULL,NULL,'admitted'");expect(values).toContain(input.requestId);expect(values).toContain('10');
    expect(sql).not.toContain('system_settings');expect((sql.match(/\?/g)||[]).length).toBe(values.length);
  });
  it('uses proper rolling/calendar boundaries and retains unknown old pending holds',async()=>{
    await tx.totals('7','2',now);const [sql,values]=c.execute.mock.calls[0];
    expect(values[0]).toEqual(new Date('2026-10-31T23:59:00Z'));expect(values[2]).toEqual(now);expect(values[4]).toEqual(now);
    expect(sql).toContain('occurred_at>?');expect(sql).toContain('finalized_at IS NULL');expect(sql).toContain('reserved_tokens IS NULL');
    expect(sql).toContain('WHERE user_id=? AND provider_id=?');expect(values.slice(-2)).toEqual(['7','2']);
    expect((sql.match(/\?/g)||[]).length).toBe(values.length);expect(sql).toContain('AS CHAR');
  });
  it('finalizes in place without changing admission month or reservation identity',async()=>{
    c.execute.mockResolvedValueOnce([{affectedRows:1}]);await tx.finalize(row,{status:'failed',inputTokens:2,outputTokens:3,durationMs:9},'reporthash',now);
    const [sql,values]=c.execute.mock.calls[0];expect(sql).toContain('UPDATE usage_records');expect(sql).toContain('WHERE id=? AND finalized_at IS NULL');
    expect(sql).not.toMatch(/SET occurred_at|SET reserved_tokens|INSERT/);expect(values).toEqual(['failed',2,3,9,'reporthash',now,'9']);
    c.execute.mockResolvedValueOnce([{affectedRows:0}]);await expect(tx.finalize(row,{status:'failed',inputTokens:0,outputTokens:0,durationMs:0},'hash',now)).rejects.toMatchObject({status:409});
  });
  it('missing-report marking never releases reserved tokens or changes actuals',async()=>{
    await tx.markMissing(row);const sql=c.execute.mock.calls[0][0];expect(sql).toContain("SET status='report_missing'");expect(sql).not.toMatch(/SET reserved_tokens|input_tokens=|finalized_at=/);
  });
  it('locks and validates active session/User/device/conversation bindings',async()=>{
    c.execute.mockResolvedValueOnce([[{conversationId:'11',deviceId:'42',status:'active',endedAt:null}]]).mockResolvedValueOnce([[{userId:'7',deviceId:'42',status:'active',deletedAt:null}]]);
    expect(await tx.context({...input,deviceId:'42',sessionId:'12',conversationId:null})).toBe('11');
    expect(c.execute.mock.calls.every((call:any[])=>call[0].includes('FOR UPDATE'))).toBe(true);
    c.execute.mockResolvedValueOnce([[{conversationId:'11',deviceId:'42',status:'revoked',endedAt:now}]]);
    await expect(tx.context({...input,deviceId:'42',sessionId:'12'})).rejects.toMatchObject({status:409});
    c.execute.mockResolvedValueOnce([[{conversationId:'11',deviceId:'42',status:'active',endedAt:null}]]);
    await expect(tx.context({...input,sessionId:'12'})).rejects.toMatchObject({status:409});
    c.execute.mockResolvedValueOnce([[{userId:'8',deviceId:null,status:'active',deletedAt:null}]]);
    await expect(tx.context({...input,conversationId:'11'})).rejects.toMatchObject({status:409});
  });
  it('scopes statistics by authenticated User and explicit date/provider; only counts final actuals',async()=>{
    await tx.statistics('7','2',now,new Date(now.getTime()+86400000));const [sql,values]=c.execute.mock.calls[0];
    expect(sql).toContain('occurred_at>=? AND occurred_at<? AND user_id=? AND provider_id=?');expect(values.slice(-2)).toEqual(['7','2']);
    expect(sql).toContain('reserved_tokens');expect(sql).not.toMatch(/secret|cipher|metadata/);expect((sql.match(/\?/g)||[]).length).toBe(values.length);
  });
});
