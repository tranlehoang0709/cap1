import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { AITransaction } from '../ai-providers/ai-providers.repository';
import { AdmissionInput, QuotaPolicy, QuotaTotals, UsageRow, UsageTotals } from './quotas.types';

const usageColumns = `CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS userId,CAST(provider_id AS CHAR) AS providerId,
  CAST(model_id AS CHAR) AS modelId,CAST(conversation_id AS CHAR) AS conversationId,CAST(ai_session_id AS CHAR) AS sessionId,
  request_id AS requestId,request_fingerprint AS fingerprint,CAST(quota_policy_id AS CHAR) AS policyId,
  CAST(reserved_tokens AS CHAR) AS reservedTokens,status,occurred_at AS occurredAt,report_due_at AS reportDueAt,
  report_fingerprint AS reportFingerprint,finalized_at AS finalizedAt`;
const final = "(finalized_at IS NOT NULL OR (request_id IS NULL AND status IN ('success','failed','cancelled')))";
const pending = "(finalized_at IS NULL AND NOT (request_id IS NULL AND status IN ('success','failed','cancelled')))";

@Injectable()
export class QuotasRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async assertSchema(): Promise<void> {
    const [columns] = await this.pool.execute<RowDataPacket[]>(`SELECT COLUMN_NAME AS name,DATA_TYPE AS type,COLLATION_NAME AS collation
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records'
      AND COLUMN_NAME IN ('request_id','request_fingerprint','quota_policy_id','reserved_tokens','report_due_at','report_fingerprint','finalized_at')
      AND (COLUMN_NAME<>'request_id' OR CHARACTER_MAXIMUM_LENGTH=128)
      AND (COLUMN_NAME NOT IN ('request_fingerprint','report_fingerprint') OR (CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin'))`);
    const types: Record<string,string> = {request_id:'varchar',request_fingerprint:'char',quota_policy_id:'bigint',reserved_tokens:'bigint',report_due_at:'datetime',report_fingerprint:'char',finalized_at:'datetime'};
    if (Object.entries(types).some(([name,type])=>!columns.some(c=>c.name===name && c.type===type && (name!=='request_id'||c.collation==='ascii_bin')))) throw new ConflictException('QUOTA_SCHEMA_NOT_READY');
    const [indexes] = await this.pool.execute<RowDataPacket[]>(`SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList,SUM(SUB_PART IS NOT NULL) AS prefixes
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records' GROUP BY INDEX_NAME,NON_UNIQUE`);
    if (!indexes.some(i=>Number(i.nonUnique)===0 && i.columnsList==='request_id' && Number(i.prefixes)===0)) throw new ConflictException('QUOTA_SCHEMA_NOT_READY');
    const [fks] = await this.pool.execute<RowDataPacket[]>(`SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records' AND COLUMN_NAME='quota_policy_id'
      AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='quota_policies' AND REFERENCED_COLUMN_NAME='id'`);
    if (!fks.length) throw new ConflictException('QUOTA_SCHEMA_NOT_READY');
  }
  async transaction<T>(work: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const c=await this.pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      try {const result=await work(new QuotaTransaction(this.pool,c));await c.commit();return result;}
      catch(e){try{await c.rollback();}catch(rollback){throw new AggregateError([e,rollback]);}throw e;}
    } finally {c.release();}
  }
  async overdueRequestIds(): Promise<string[]> {
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT request_id AS id FROM usage_records WHERE status='admitted'
      AND finalized_at IS NULL AND report_due_at<=UTC_TIMESTAMP() ORDER BY report_due_at,id LIMIT 100`);
    return rows.map(r=>r.id);
  }
  async locateRequest(id: string): Promise<UsageRow | null> {
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT ${usageColumns} FROM usage_records WHERE request_id=?`,[id]);
    return (rows[0] as UsageRow | undefined) ?? null;
  }
}

export class QuotaTransaction {
  readonly ai: AITransaction;
  constructor(pool: Pool, private readonly c: PoolConnection) {this.ai=new AITransaction(pool,c);}
  private async rows<T>(sql: string, values: unknown[]=[]): Promise<T[]> {const [rows]=await this.c.execute<RowDataPacket[]>(sql,values as never[]);return rows as T[];}
  async now(): Promise<Date> {return (await this.rows<{now:Date}>('SELECT UTC_TIMESTAMP() AS now'))[0].now;}
  policies(userId: string,providerId: string) {return this.rows<QuotaPolicy>(`SELECT CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS userId,
    CAST(provider_id AS CHAR) AS providerId,requests_per_minute AS requestsPerMinute,requests_per_day AS requestsPerDay,
    CAST(tokens_per_month AS CHAR) AS tokensPerMonth FROM quota_policies WHERE user_id=? AND provider_id=? AND is_active=1 ORDER BY id FOR UPDATE`,[userId,providerId]);}
  async request(id: string): Promise<UsageRow | null> {return (await this.rows<UsageRow>(`SELECT ${usageColumns} FROM usage_records WHERE request_id=? FOR UPDATE`,[id]))[0]??null;}
  async userMinuteRequests(userId: string, now: Date): Promise<string> {
    return (await this.rows<{count:string}>(`SELECT CAST(COUNT(*) AS CHAR) AS count FROM usage_records
      WHERE user_id=? AND request_kind='LLM' AND occurred_at>? AND occurred_at<=?`,[userId,new Date(now.getTime()-60000),now]))[0].count;
  }
  async totals(userId: string,providerId: string,now: Date): Promise<QuotaTotals> {
    const day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
    return (await this.rows<QuotaTotals>(`SELECT
      CAST(COALESCE(SUM(occurred_at>? AND occurred_at<=?),0) AS CHAR) AS minuteRequests,
      CAST(COALESCE(SUM(occurred_at>=? AND occurred_at<=?),0) AS CHAR) AS dayRequests,
      CAST(COALESCE(SUM(CASE WHEN occurred_at>=? AND occurred_at<=? AND ${final} THEN COALESCE(input_tokens,0)+COALESCE(output_tokens,0) ELSE 0 END),0) AS CHAR) AS monthTokens,
      CAST(COALESCE(SUM(CASE WHEN ${pending} THEN COALESCE(reserved_tokens,0) ELSE 0 END),0) AS CHAR) AS reservedTokens,
      CAST(COALESCE(SUM(${pending} AND reserved_tokens IS NULL),0) AS CHAR) AS unboundedRequests
      FROM usage_records WHERE user_id=? AND provider_id=?`,[new Date(now.getTime()-60000),now,day,now,month,now,userId,providerId]))[0];
  }
  async context(i: AdmissionInput): Promise<string|null> {
    let conversationId=i.conversationId;
    if(i.sessionId){
      const s=(await this.rows<{conversationId:string;deviceId:string|null;status:string;endedAt:Date|null}>(`SELECT CAST(conversation_id AS CHAR) AS conversationId,
        CAST(device_id AS CHAR) AS deviceId,status,ended_at AS endedAt FROM ai_sessions WHERE id=? FOR UPDATE`,[i.sessionId]))[0];
      if(!s || s.status!=='active' || s.endedAt!==null || s.deviceId!==i.deviceId || (conversationId!==null && conversationId!==s.conversationId)) throw new ConflictException('INVALID_AI_CONTEXT');
      conversationId=s.conversationId;
    }
    if(conversationId){
      const c=(await this.rows<{userId:string;deviceId:string|null;status:string;deletedAt:Date|null;endedAt?:Date|null}>(`SELECT CAST(user_id AS CHAR) AS userId,
        CAST(device_id AS CHAR) AS deviceId,status,deleted_at AS deletedAt,ended_at AS endedAt FROM conversations WHERE id=? FOR UPDATE`,[conversationId]))[0];
      if(!c || c.userId!==i.userId || c.deviceId!==i.deviceId || c.status!=='active' || c.deletedAt!==null || c.endedAt) throw new ConflictException('INVALID_AI_CONTEXT');
    }
    return conversationId;
  }
  async admit(i: AdmissionInput,hash: string,policyId: string,credentialId: string|null,conversationId: string|null,now: Date,due: Date) {
    await this.c.execute(`INSERT INTO usage_records(user_id,conversation_id,ai_session_id,provider_id,model_id,credential_id,
      request_kind,input_tokens,output_tokens,duration_ms,status,occurred_at,request_id,request_fingerprint,quota_policy_id,reserved_tokens,report_due_at)
      VALUES(?,?,?,?,?,?,'LLM',NULL,NULL,NULL,'admitted',?,?,?,?,?,?)`,
    [i.userId,conversationId,i.sessionId,i.providerId,i.modelId,credentialId,now,i.requestId,hash,policyId,i.maxTotalTokens,due]);
  }
  async finalize(row: UsageRow,u: {status:string;inputTokens:number;outputTokens:number;durationMs:number},hash: string,now: Date) {
    const [r]=await this.c.execute<ResultSetHeader>(`UPDATE usage_records SET status=?,input_tokens=?,output_tokens=?,duration_ms=?,report_fingerprint=?,finalized_at=?
      WHERE id=? AND finalized_at IS NULL`,[u.status,u.inputTokens,u.outputTokens,u.durationMs,hash,now,row.id]);
    if(r.affectedRows!==1) throw new ConflictException('USAGE_REPORT_CONFLICT');
  }
  async markMissing(row: UsageRow) {await this.c.execute("UPDATE usage_records SET status='report_missing' WHERE id=? AND status='admitted' AND finalized_at IS NULL",[row.id]);}
  async audit(actor: string|null,action: string,entityId: string|null,metadata: unknown) {
    await this.c.execute("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata,occurred_at) VALUES(?,?,'AI_QUOTA',?,?,UTC_TIMESTAMP())",[actor,action,entityId,JSON.stringify(metadata)]);
  }
  async replacePolicy(userId: string,providerId: string,p: {requestsPerMinute:number|null;requestsPerDay:number|null;tokensPerMonth:string|null},now: Date) {
    await this.c.execute('UPDATE quota_policies SET is_active=0,updated_at=? WHERE user_id=? AND provider_id=? AND is_active=1',[now,userId,providerId]);
    await this.c.execute(`INSERT INTO quota_policies(user_id,provider_id,requests_per_minute,requests_per_day,tokens_per_month,is_active,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?)`,[userId,providerId,p.requestsPerMinute,p.requestsPerDay,p.tokensPerMonth,now,now]);
    return (await this.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
  }
  async statistics(userId: string|null,providerId: string|null,from: Date,to: Date): Promise<UsageTotals> {
    const conditions=['occurred_at>=? AND occurred_at<?'];const values:unknown[]=[from,to];
    if(userId){conditions.push('user_id=?');values.push(userId);}if(providerId){conditions.push('provider_id=?');values.push(providerId);}
    return (await this.rows<UsageTotals>(`SELECT CAST(COUNT(*) AS CHAR) AS requestsUsed,
      CAST(COALESCE(SUM(CASE WHEN ${final} THEN COALESCE(input_tokens,0) ELSE 0 END),0) AS CHAR) AS inputTokens,
      CAST(COALESCE(SUM(CASE WHEN ${final} THEN COALESCE(output_tokens,0) ELSE 0 END),0) AS CHAR) AS outputTokens,
      CAST(COALESCE(SUM(CASE WHEN NOT ${final} THEN COALESCE(reserved_tokens,0) ELSE 0 END),0) AS CHAR) AS reservedTokens,
      CAST(COALESCE(SUM(NOT ${final} AND reserved_tokens IS NULL),0) AS CHAR) AS unboundedRequests
      FROM usage_records WHERE ${conditions.join(' AND ')}`,values))[0];
  }
}
