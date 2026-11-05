import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AITransaction } from '../ai-providers/ai-providers.repository';
import { QuotasRepository, QuotaTransaction } from './quotas.repository';
import { AdmissionInput, UsageRow, QuotaTotals, UsageTotals } from './quotas.types';

/** Reserved operational namespace; never editable through the settings API. */
export const V15_LEDGER_PREFIX = 'aiva.quota.v15.';
export function v15LedgerKey(requestId: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new ConflictException('QUOTA_LEDGER_INVALID');
  return V15_LEDGER_PREFIX + createHash('sha256').update(requestId).digest('hex');
}
export function decodeV15Ledger(value: unknown): UsageRow {
  const invalid = (): never => { throw new ConflictException('QUOTA_LEDGER_INVALID'); };
  let body: any;
  try { body = typeof value === 'string' ? JSON.parse(value) : value; } catch { return invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1) return invalid();
  const id = (v: unknown, nullable = false) => nullable && v === null || typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
  if (!['id','userId','providerId','modelId','policyId'].every(k => id(body[k])) ||
      !['conversationId','sessionId'].every(k => id(body[k],true)) ||
      typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId) ||
      !/^[a-f0-9]{64}$/.test(body.fingerprint ?? '') ||
      !(body.reservedTokens === null || typeof body.reservedTokens === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(body.reservedTokens) && BigInt(body.reservedTokens)<=9223372036854775807n) ||
      !['admitted','report_missing','success','failed','cancelled'].includes(body.status)) return invalid();
  const date = (v: unknown, nullable = false): Date|null => {
    if (nullable && v === null) return null;
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return invalid();
    const d=new Date(v); if (!Number.isFinite(d.getTime()) || d.toISOString()!==v) return invalid(); return d;
  };
  const occurredAt=date(body.occurredAt)!, reportDueAt=date(body.reportDueAt), finalizedAt=date(body.finalizedAt,true);
  if (!reportDueAt || reportDueAt<occurredAt || (finalizedAt!==null)!==['success','failed','cancelled'].includes(body.status) ||
      !(body.reportFingerprint === null || typeof body.reportFingerprint==='string' && /^[a-f0-9]{64}$/.test(body.reportFingerprint)) ||
      (finalizedAt!==null)!==(body.reportFingerprint!==null)) return invalid();
  return {id:body.id,userId:body.userId,providerId:body.providerId,modelId:body.modelId,
    conversationId:body.conversationId,sessionId:body.sessionId,requestId:body.requestId,fingerprint:body.fingerprint,
    policyId:body.policyId,reservedTokens:body.reservedTokens,status:body.status,occurredAt,reportDueAt,
    reportFingerprint:body.reportFingerprint,finalizedAt};
}
export async function inspectV15QuotaSchema(pool: Pool): Promise<void> {
  const [rows]=await pool.execute<RowDataPacket[]>("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('usage_records','system_settings','users','quota_policies','conversations','ai_sessions','messages')");
  const required: Record<string,string[]>={usage_records:['id','user_id','provider_id','model_id','conversation_id','ai_session_id','status','input_tokens','output_tokens','duration_ms','occurred_at'],
    system_settings:['setting_key','setting_value','updated_by','updated_at'],users:['id'],quota_policies:['id'],conversations:['id','user_id'],ai_sessions:['id','conversation_id'],messages:['id','conversation_id','content']};
  if (Object.entries(required).some(([table,columns])=>columns.some(column=>!rows.some(r=>r.TABLE_NAME===table&&r.COLUMN_NAME===column)))) throw new ConflictException('QUOTA_SCHEMA_NOT_READY');
  const [tables]=await pool.execute<RowDataPacket[]>("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('usage_records','system_settings','users','quota_policies','conversations','ai_sessions','messages')");
  if (Object.keys(required).some(table=>!tables.some(r=>r.TABLE_NAME===table&&r.ENGINE==='InnoDB'))) throw new ConflictException('QUOTA_SCHEMA_NOT_READY');
}

/** Opt-in adapter. New admission needs approval; authorized settlement of existing requests remains available. */
export class V15QuotasRepository extends QuotasRepository {
  constructor(private readonly v15pool: Pool, private readonly approved = false) { super(v15pool); }
  override async assertSchema(): Promise<void> { await inspectV15QuotaSchema(this.v15pool); }
  override async transaction<T>(work: (tx: QuotaTransaction)=>Promise<T>): Promise<T> {
    const c=await this.v15pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await c.beginTransaction();
      try { const result=await work(new V15QuotaTransaction(this.v15pool,c,this.approved)); await c.commit(); return result; }
      catch(error){ try {await c.rollback();}catch(rollback){throw new AggregateError([error,rollback]);}throw error; }
    } finally {c.release();}
  }
  override async locateRequest(id: string): Promise<UsageRow|null> {
    const [rows]=await this.v15pool.execute<RowDataPacket[]>('SELECT setting_value AS value FROM system_settings WHERE setting_key=?',[v15LedgerKey(id)]);
    if (!rows[0]) return null; const record=decodeV15Ledger(rows[0].value);
    if(record.requestId!==id) throw new ConflictException('QUOTA_LEDGER_INVALID'); return record;
  }
  override async overdueRequestIds(): Promise<string[]> {
    const [clock]=await this.v15pool.execute<RowDataPacket[]>('SELECT UTC_TIMESTAMP() AS now');
    const [rows]=await this.v15pool.execute<RowDataPacket[]>('SELECT setting_key AS keyName,setting_value AS value FROM system_settings WHERE setting_key LIKE ?',[V15_LEDGER_PREFIX+'%']);
    return rows.map(row=>{const r=decodeV15Ledger(row.value);if(v15LedgerKey(r.requestId)!==row.keyName)throw new ConflictException('QUOTA_LEDGER_INVALID');return r;})
      .filter(r=>r.status==='admitted'&&!r.finalizedAt&&r.reportDueAt!<=clock[0].now).sort((a,b)=>a.reportDueAt!.getTime()-b.reportDueAt!.getTime()).slice(0,100).map(r=>r.requestId);
  }
}

type BaseUsage = {id:string;userId:string;providerId:string;modelId:string|null;conversationId:string|null;sessionId:string|null;status:string;occurredAt:Date;inputTokens:string|null;outputTokens:string|null};
const baseColumns='CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS userId,CAST(provider_id AS CHAR) AS providerId,CAST(model_id AS CHAR) AS modelId,CAST(conversation_id AS CHAR) AS conversationId,CAST(ai_session_id AS CHAR) AS sessionId,status,occurred_at AS occurredAt,CAST(input_tokens AS CHAR) AS inputTokens,CAST(output_tokens AS CHAR) AS outputTokens';
const terminal = (status:string) => ['success','failed','cancelled'].includes(status);

export class V15QuotaTransaction extends QuotaTransaction {
  constructor(pool:Pool,private readonly v15c:PoolConnection,private readonly admissionApproved=false){super(pool,v15c);}
  private async vrows<T>(sql:string,args:unknown[]=[]):Promise<T[]> {const [rows]=await this.v15c.execute<RowDataPacket[]>(sql,args as never[]);return rows as T[];}
  private async metadata(id:string,lock=true):Promise<UsageRow|null>{
    const rows=await this.vrows<{value:unknown}>('SELECT setting_value AS value FROM system_settings WHERE setting_key=?'+(lock?' FOR UPDATE':''),[v15LedgerKey(id)]);
    if(!rows[0])return null;const r=decodeV15Ledger(rows[0].value);if(r.requestId!==id)throw new ConflictException('QUOTA_LEDGER_INVALID');return r;
  }
  private async save(r:UsageRow):Promise<void>{
    const [result]=await this.v15c.execute<ResultSetHeader>('UPDATE system_settings SET setting_value=?,updated_at=UTC_TIMESTAMP() WHERE setting_key=?',[JSON.stringify({version:1,...r}),v15LedgerKey(r.requestId)]);
    if(result.affectedRows!==1)throw new ConflictException('USAGE_REPORT_CONFLICT');
  }
  override async request(id:string):Promise<UsageRow|null>{
    const r=await this.metadata(id);if(!r)return null;
    const b=(await this.vrows<BaseUsage>('SELECT '+baseColumns+' FROM usage_records WHERE id=? FOR UPDATE',[r.id]))[0];
    if(!b||['userId','providerId','modelId','conversationId','sessionId','status'].some(k=>(b as any)[k] !== (r as any)[k]) || terminal(b.status)!==Boolean(r.finalizedAt))throw new ConflictException('QUOTA_LEDGER_INVALID');
    return r;
  }
  override async admit(i:AdmissionInput,fingerprint:string,policyId:string,credentialId:string|null,conversationId:string|null,now:Date,due:Date):Promise<void>{
    if (!this.admissionApproved) throw new ConflictException('V15_QUOTA_CONTRACT_NOT_APPROVED');
    await this.v15c.execute("INSERT INTO usage_records(user_id,conversation_id,ai_session_id,provider_id,model_id,credential_id,request_kind,input_tokens,output_tokens,duration_ms,status,occurred_at) VALUES(?,?,?,?,?,?,'LLM',NULL,NULL,NULL,'admitted',?)",[i.userId,conversationId,i.sessionId,i.providerId,i.modelId,credentialId,now]);
    const id=(await this.vrows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
    const r:UsageRow={id,userId:i.userId,providerId:i.providerId,modelId:i.modelId,conversationId,sessionId:i.sessionId,requestId:i.requestId,fingerprint,policyId,reservedTokens:i.maxTotalTokens,status:'admitted',occurredAt:now,reportDueAt:due,reportFingerprint:null,finalizedAt:null};
    // PK on the hashed request key makes duplicate IDs roll back the entire admission.
    await this.v15c.execute('INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,?)',[v15LedgerKey(i.requestId),JSON.stringify({version:1,...r}),i.userId,now]);
  }
  override async finalize(row:UsageRow,u:{status:string;inputTokens:number;outputTokens:number;durationMs:number},fingerprint:string,now:Date):Promise<void>{
    const r=await this.request(row.requestId);if(!r||r.finalizedAt)throw new ConflictException('USAGE_REPORT_CONFLICT');
    const [result]=await this.v15c.execute<ResultSetHeader>("UPDATE usage_records SET status=?,input_tokens=?,output_tokens=?,duration_ms=? WHERE id=? AND status IN ('admitted','report_missing')",[u.status,u.inputTokens,u.outputTokens,u.durationMs,r.id]);
    if(result.affectedRows!==1)throw new ConflictException('USAGE_REPORT_CONFLICT');
    await this.save({...r,status:u.status,reportFingerprint:fingerprint,finalizedAt:now});
  }
  override async markMissing(row:UsageRow):Promise<void>{
    const r=await this.request(row.requestId);if(!r||r.finalizedAt||r.status!=='admitted')throw new ConflictException('USAGE_REPORT_CONFLICT');
    const [result]=await this.v15c.execute<ResultSetHeader>("UPDATE usage_records SET status='report_missing' WHERE id=? AND status='admitted'",[r.id]);
    if(result.affectedRows!==1)throw new ConflictException('USAGE_REPORT_CONFLICT');
    await this.save({...r,status:'report_missing'}); // reservation is deliberately retained until actual settlement
  }
  private async accounting(userId:string|null,providerId:string|null):Promise<{rows:BaseUsage[];records:Map<string,UsageRow>}>{
    const conditions:string[]=[],args:unknown[]=[];
    if(userId){conditions.push('user_id=?');args.push(userId);}if(providerId){conditions.push('provider_id=?');args.push(providerId);}
    const rows=await this.vrows<BaseUsage>('SELECT '+baseColumns+' FROM usage_records'+(conditions.length?' WHERE '+conditions.join(' AND '):''),args);
    const mconditions=['setting_key LIKE ?'],margs:unknown[]=[V15_LEDGER_PREFIX+'%'];
    if(userId){mconditions.push("JSON_UNQUOTE(JSON_EXTRACT(setting_value,'$.userId'))=?");margs.push(userId);}
    if(providerId){mconditions.push("JSON_UNQUOTE(JSON_EXTRACT(setting_value,'$.providerId'))=?");margs.push(providerId);}
    const meta=await this.vrows<{keyName:string;value:unknown}>('SELECT setting_key AS keyName,setting_value AS value FROM system_settings WHERE '+mconditions.join(' AND '),margs);
    const records=new Map<string,UsageRow>();
    for(const item of meta){const r=decodeV15Ledger(item.value);if(v15LedgerKey(r.requestId)!==item.keyName||records.has(r.id))throw new ConflictException('QUOTA_LEDGER_INVALID');records.set(r.id,r);}
    for(const b of rows){const r=records.get(b.id);if(r&&(['userId','providerId','modelId','conversationId','sessionId','status'].some(k=>(b as any)[k] !== (r as any)[k]) || terminal(b.status)!==Boolean(r.finalizedAt)))throw new ConflictException('QUOTA_LEDGER_INVALID');}
    return {rows,records};
  }
  override async totals(userId:string,providerId:string,now:Date):Promise<QuotaTotals>{
    const {rows,records}=await this.accounting(userId,providerId);const day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),month=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
    let minute=0n,daily=0n,tokens=0n,reserved=0n,unbounded=0n;
    for(const b of rows){const time=b.occurredAt.getTime();if(time>now.getTime()-60000&&time<=now.getTime())minute++;if(time>=day&&time<=now.getTime())daily++;
      if(terminal(b.status)){if(time>=month&&time<=now.getTime())tokens+=BigInt(b.inputTokens??'0')+BigInt(b.outputTokens??'0');}
      else {const r=records.get(b.id);if(!r||r.reservedTokens===null)unbounded++;else reserved+=BigInt(r.reservedTokens);}}
    return {minuteRequests:String(minute),dayRequests:String(daily),monthTokens:String(tokens),reservedTokens:String(reserved),unboundedRequests:String(unbounded)};
  }
  override async statistics(userId:string|null,providerId:string|null,from:Date,to:Date):Promise<UsageTotals>{
    const {rows,records}=await this.accounting(userId,providerId);let requests=0n,input=0n,output=0n,reserved=0n,unbounded=0n;
    for(const b of rows){if(b.occurredAt<from||b.occurredAt>=to)continue;requests++;
      if(terminal(b.status)){input+=BigInt(b.inputTokens??'0');output+=BigInt(b.outputTokens??'0');}
      else{const r=records.get(b.id);if(!r||r.reservedTokens===null)unbounded++;else reserved+=BigInt(r.reservedTokens);}}
    return {requestsUsed:String(requests),inputTokens:String(input),outputTokens:String(output),reservedTokens:String(reserved),unboundedRequests:String(unbounded)};
  }
}

/** Exact request/owner/session binding before existing history writes; no schema extension. */
export async function v15SettledUsage(tx:AITransaction,userId:string,sessionId:string,conversationId:string,requestId:string):Promise<{providerId:string}|null>{
  const rows=await tx.rows<{value:unknown}>('SELECT setting_value AS value FROM system_settings WHERE setting_key=? FOR UPDATE',[v15LedgerKey(requestId)]);
  if(!rows[0])return null;const r=decodeV15Ledger(rows[0].value);
  if(r.requestId!==requestId||r.userId!==userId||r.sessionId!==sessionId||r.conversationId!==conversationId||r.status!=='success'||!r.finalizedAt)return null;
  const settled=await tx.rows<{providerId:string}>("SELECT CAST(provider_id AS CHAR) AS providerId FROM usage_records WHERE id=? AND user_id=? AND ai_session_id=? AND conversation_id=? AND provider_id=? AND status='success' FOR UPDATE",[r.id,userId,sessionId,conversationId,r.providerId]);
  return settled[0]??null;
}
