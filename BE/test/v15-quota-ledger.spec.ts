import { ConfigService } from '@nestjs/config';
import { V15_LEDGER_PREFIX, v15LedgerKey, decodeV15Ledger, V15QuotaTransaction, V15QuotasRepository, v15SettledUsage } from '../src/modules/quotas/v15-quota-ledger';
import { SystemSettingsService } from '../src/modules/system-settings/system-settings.service';

// Isolated SQL-adapter regressions. No fixture result is claimed as LIVE quota execution.
const now=new Date('2026-11-06T00:00:00Z'),requestId='local-request-00000001';
const record=(patch:Record<string,unknown>={})=>({version:1,id:'10',userId:'7',providerId:'1',modelId:'3',conversationId:'8',sessionId:'9',requestId,
 fingerprint:'a'.repeat(64),policyId:'2',reservedTokens:'80',status:'admitted',occurredAt:now.toISOString(),reportDueAt:new Date(now.getTime()+30000).toISOString(),reportFingerprint:null,finalizedAt:null,...patch});
function harness(initial:any[]=[],metadata:any[]=[]){
 const rows=new Map(initial.map(r=>[r.id,{...r}]));const settings=new Map(metadata.map(r=>[v15LedgerKey(r.requestId),JSON.stringify(r)]));let sequence=10;
 const sqls:string[]=[];let snapshot:any;
 const c:any={query:jest.fn(),beginTransaction:jest.fn(async()=>{snapshot={rows:structuredClone(rows),settings:structuredClone(settings)};}),commit:jest.fn(),rollback:jest.fn(async()=>{rows.clear();settings.clear();for(const [k,v]of snapshot.rows)rows.set(k,v);for(const [k,v]of snapshot.settings)settings.set(k,v);}),release:jest.fn()};
 c.execute=jest.fn(async(sql:string,args:any[]=[])=>{sqls.push(sql);
  if(sql.startsWith('INSERT INTO usage_records')){const id=String(sequence++);rows.set(id,{id,userId:args[0],conversationId:args[1],sessionId:args[2],providerId:args[3],modelId:args[4],status:'admitted',occurredAt:args[6],inputTokens:null,outputTokens:null});return [{affectedRows:1}];}
  if(sql.includes('LAST_INSERT_ID()'))return [[{id:String(sequence-1)}]];
  if(sql.startsWith('INSERT INTO system_settings')){if(settings.has(args[0]))throw {code:'ER_DUP_ENTRY'};settings.set(args[0],args[1]);return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE system_settings')){if(!settings.has(args[1]))return [{affectedRows:0}];settings.set(args[1],args[0]);return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE usage_records SET status='report_missing'")){const r=rows.get(args[0]);if(!r||r.status!=='admitted')return [{affectedRows:0}];r.status='report_missing';return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE usage_records SET status=?')){const r=rows.get(args[4]);if(!r||!['admitted','report_missing'].includes(r.status))return [{affectedRows:0}];Object.assign(r,{status:args[0],inputTokens:String(args[1]),outputTokens:String(args[2])});return [{affectedRows:1}];}
  if(sql.includes('FROM system_settings WHERE setting_key=?'))return [[...(settings.has(args[0])?[{value:settings.get(args[0])}]:[])]];
  if(sql.includes('FROM system_settings WHERE setting_key LIKE'))return [[...settings].map(([keyName,value])=>({keyName,value}))];
  if(sql.includes('FROM usage_records WHERE id=?'))return [[...(rows.has(args[0])?[rows.get(args[0])]:[])]];
  if(sql.includes('FROM usage_records'))return [[...rows.values()]];
  return [[]];
 });
 const pool:any={execute:c.execute,getConnection:jest.fn(async()=>c)};
 return {rows,settings,sqls,c,pool,tx:new V15QuotaTransaction(pool,c,true)};
}
const base=(patch:Record<string,unknown>={})=>({id:'10',userId:'7',providerId:'1',modelId:'3',conversationId:'8',sessionId:'9',status:'admitted',occurredAt:now,inputTokens:null,outputTokens:null,...patch});
const admission={requestId,userId:'7',providerId:'1',modelId:'3',deviceId:null,sessionId:'9',conversationId:'8',maxTotalTokens:'80'};
describe('V1.5 durable request namespace and strict metadata',()=>{
 it('uses a bounded deterministic key and preserves the full request ID inside JSON',()=>{
  expect(v15LedgerKey('x'.repeat(128)).length).toBeLessThanOrEqual(120);
  expect(v15LedgerKey(requestId)).toBe(v15LedgerKey(requestId));expect(v15LedgerKey(requestId+'2')).not.toBe(v15LedgerKey(requestId));
  expect(decodeV15Ledger(record())).toMatchObject({requestId,reservedTokens:'80',occurredAt:now});
 });
 it.each([{reservedTokens:'-1'},{fingerprint:'bad'},{status:'success'},{finalizedAt:'bad'},{version:2}])('fails closed on corrupt metadata %j',patch=>{
  expect(()=>decodeV15Ledger(record(patch))).toThrow('QUOTA_LEDGER_INVALID');
 });
 it('cannot be activated merely by selecting the adapter',async()=>{
  const h=harness();const repo=new V15QuotasRepository(h.pool);
  await expect(repo.transaction(tx=>tx.admit(admission,'a'.repeat(64),'2',null,'8',now,new Date(now.getTime()+30000)))).rejects.toThrow('V15_QUOTA_CONTRACT_NOT_APPROVED');
  expect(h.c.execute).not.toHaveBeenCalled();expect(h.rows.size).toBe(0);expect(h.settings.size).toBe(0);
 });
 it('prevents even Admin settings updates from forging operational ledger records',()=>{
  const repo={upsert:jest.fn()};const service=new SystemSettingsService(repo as any);
  expect(()=>service.upsert(V15_LEDGER_PREFIX+'x',{},'1')).toThrow('Reserved operational ledger namespace');
  expect(()=>service.upsert(V15_LEDGER_PREFIX.toUpperCase()+'x',{},'1')).toThrow('Reserved operational ledger namespace');
  expect(repo.upsert).not.toHaveBeenCalled();
 });
});
describe('V1.5 admission, settlement and reservation accounting',()=>{
 it('persists metadata and a base usage row atomically, using no extension columns or DDL',async()=>{
  const h=harness();const repo=new V15QuotasRepository(h.pool,true);
  await repo.transaction(tx=>tx.admit(admission,'a'.repeat(64),'2',null,'8',now,new Date(now.getTime()+30000)));
  expect(h.rows.size).toBe(1);expect(h.settings.size).toBe(1);expect(h.c.commit).toHaveBeenCalledTimes(1);
  expect(h.sqls.join('\n')).not.toMatch(/ALTER |CREATE |DROP |request_id|request_fingerprint|quota_policy_id|reserved_tokens|report_due_at|report_fingerprint|finalized_at/);
  expect(JSON.parse([...h.settings.values()][0])).toMatchObject({version:1,requestId,reservedTokens:'80'});
  expect(JSON.stringify([...h.settings.values()])).not.toMatch(/prompt|content|credential/);
 });
 it('rolls back the loser when duplicate request keys race, preserving the original reservation',async()=>{
  const h=harness();const repo=new V15QuotasRepository(h.pool,true);
  const work=(tx:any)=>tx.admit(admission,'a'.repeat(64),'2',null,'8',now,new Date(now.getTime()+30000));
  await repo.transaction(work);await expect(repo.transaction(work)).rejects.toMatchObject({code:'ER_DUP_ENTRY'});
  expect(h.rows.size).toBe(1);expect(h.settings.size).toBe(1);expect(h.c.rollback).toHaveBeenCalledTimes(1);expect(h.c.release).toHaveBeenCalledTimes(2);
 });
 it('keeps missing-report reservations and settles actual usage once',async()=>{
  const h=harness([base()],[record()]);let r=await h.tx.request(requestId);expect(r).not.toBeNull();
  await h.tx.markMissing(r!);r=await h.tx.request(requestId);
  expect(r).toMatchObject({status:'report_missing',reservedTokens:'80',finalizedAt:null});
  await h.tx.finalize(r!,{status:'success',inputTokens:5,outputTokens:8,durationMs:10},'b'.repeat(64),now);
  const settled=await h.tx.request(requestId);expect(settled).toMatchObject({status:'success',reportFingerprint:'b'.repeat(64),finalizedAt:now});
  expect(h.rows.get('10')).toMatchObject({inputTokens:'5',outputTokens:'8'});
  await expect(h.tx.finalize(settled!,{status:'success',inputTokens:9,outputTokens:9,durationMs:10},'c'.repeat(64),now)).rejects.toThrow('USAGE_REPORT_CONFLICT');
 });
 it('counts old usage, carries old-month reservations, and treats unknown pending rows as unbounded',async()=>{
  const oldMonth=new Date('2026-10-31T00:00:00Z');
  const h=harness([base({id:'11',status:'success',occurredAt:now,inputTokens:'20',outputTokens:'30'}),base({occurredAt:oldMonth}),base({id:'12'})],[record({occurredAt:oldMonth.toISOString(),reportDueAt:new Date(oldMonth.getTime()+30000).toISOString()})]);
  expect(await h.tx.totals('7','1',now)).toEqual({minuteRequests:'2',dayRequests:'2',monthTokens:'50',reservedTokens:'80',unboundedRequests:'1'});
  expect(await h.tx.statistics('7','1',new Date('2026-11-01T00:00:00Z'),new Date('2026-12-01T00:00:00Z'))).toEqual({requestsUsed:'2',inputTokens:'20',outputTokens:'30',reservedTokens:'0',unboundedRequests:'1'});
 });
 it('allows actual settlement of existing admission after new-admission approval is revoked',async()=>{
  const h=harness([base()],[record()]);const repo=new V15QuotasRepository(h.pool,false);
  await repo.transaction(async tx=>{const row=await tx.request(requestId);await tx.finalize(row!,{status:'success',inputTokens:5,outputTokens:8,durationMs:10},'b'.repeat(64),now);});
  expect(h.rows.get('10').status).toBe('success');
  await expect(repo.transaction(tx=>tx.admit({...admission,requestId:requestId+'2'},'a'.repeat(64),'2',null,'8',now,new Date(now.getTime()+30000)))).rejects.toThrow('V15_QUOTA_CONTRACT_NOT_APPROVED');
 });
 it('rejects mismatched base row ownership rather than trusting JSON alone',async()=>{
  const h=harness([base({userId:'99'})],[record()]);await expect(h.tx.request(requestId)).rejects.toThrow('QUOTA_LEDGER_INVALID');
 });
});
describe('V1.5 history settlement lookup',()=>{
 it('binds history to the settled request, user, session and conversation before any write',async()=>{
  const value=record({status:'success',reportFingerprint:'b'.repeat(64),finalizedAt:now.toISOString()});
  const tx={rows:jest.fn().mockResolvedValueOnce([{value:JSON.stringify(value)}]).mockResolvedValueOnce([{providerId:'1'}])};
  expect(await v15SettledUsage(tx as any,'7','9','8',requestId)).toEqual({providerId:'1'});
  expect(tx.rows.mock.calls[1][1]).toEqual(['10','7','9','8','1']);
  const other={rows:jest.fn().mockResolvedValue([{value:JSON.stringify(value)}])};
  expect(await v15SettledUsage(other as any,'99','9','8',requestId)).toBeNull();expect(other.rows).toHaveBeenCalledTimes(1);
 });
});
