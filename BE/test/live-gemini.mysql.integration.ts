/** Real SQL, isolated schema, synthetic provider actuals. NOT a LIVE Gemini test. */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createPool, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConfigService } from '@nestjs/config';
import { AiProvidersRepository } from '../src/modules/ai-providers/ai-providers.repository';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';
import { SecretEncryptionService } from '../src/modules/api-keys/secret-encryption.service';
import { QuotasRepository } from '../src/modules/quotas/quotas.repository';
import { QuotasService } from '../src/modules/quotas/quotas.service';

describe('D2-S2-15 isolated actual MySQL settlement and persistence',()=>{
 let pool:Pool,ai:AiProvidersService,quota:QuotasService,userId:string,providerId:string,modelId:string;
 async function insert(sql:string,values:unknown[]){const [r]=await pool.execute<ResultSetHeader>(sql,values as never[]);return String(r.insertId);}
 beforeAll(async()=>{
  if(process.env.MYSQL_INTEGRATION_TESTS!=='true')throw new Error('Explicit isolated opt-in required');
  const connection=JSON.parse(readFileSync('.env.test.connection.json','utf8'));
  if(!/^aiva_iot_test_d2s215_[a-f0-9]+$/.test(connection.database))throw new Error('Working schema forbidden');
  pool=createPool({...connection,supportBigNumbers:true,bigNumberStrings:true,timezone:'Z',connectionLimit:5});
  const [identity]=await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if(identity[0].name!==connection.database)throw new Error('Wrong schema');
  const prefix=randomBytes(6).toString('hex');
  const config=new ConfigService({AI_CONFIG_CONTRACT_APPROVED:'true',AI_QUOTA_CONTRACT_APPROVED:'true',
   AI_USAGE_REPORT_TIMEOUT_SECONDS:'30',AI_SECRET_KEY_BASE64:randomBytes(32).toString('base64'),AI_SECRET_KEY_ID:'isolated'});
  const crypto=new SecretEncryptionService(config);
  ai=new AiProvidersService(new AiProvidersRepository(pool),crypto,config);
  quota=new QuotasService(new QuotasRepository(pool),ai,config);
  userId=await insert("INSERT INTO users(email,password_hash,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Isolated test','active',UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())",[prefix+'@example.test','not-a-login-hash']);
  await pool.execute("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code='USER'",[userId]);
  await pool.execute('INSERT INTO privacy_preferences(user_id,save_history,updated_at) VALUES(?,1,UTC_TIMESTAMP())',[userId]);
  const [p]=await pool.query<RowDataPacket[]>("SELECT CAST(id AS CHAR) AS id FROM ai_providers WHERE code='GEMINI'");providerId=p[0].id;
  modelId=await insert("INSERT INTO ai_models(provider_id,model_code,capability,is_enabled) VALUES(?,?,'llm',1)",[providerId,'isolated-'+prefix]);
  await pool.execute("INSERT INTO ai_profiles(user_id,system_prompt,preferred_provider_id,preferred_llm_model_id,updated_at) VALUES(?,'Isolated prompt',?,?,UTC_TIMESTAMP())",[userId,providerId,modelId]);
  await pool.execute("INSERT INTO api_credentials(provider_id,owner_scope,owner_user_id,label,secret_ciphertext,is_active,created_at) VALUES(?,'USER',?,'Isolated credential',?,1,UTC_TIMESTAMP())",[providerId,userId,crypto.encrypt('isolated-not-a-real-provider-key',`USER:${userId}:${providerId}`)]);
  await pool.execute('INSERT INTO quota_policies(user_id,provider_id,requests_per_minute,requests_per_day,tokens_per_month,is_active,created_at,updated_at) VALUES(?,?,12,12,1000,1,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[userId,providerId]);
 });
 afterAll(async()=>{if(pool)await pool.end();});
 it('commits usage and two messages, then deduplicates identical reports/completion',async()=>{
  const resolved=await ai.resolveAIConfiguration({userId,providerId,includeCredential:true});
  expect(resolved.credential).toBe('isolated-not-a-real-provider-key');
  const turn=await ai.startTurn({userId,channel:'web'});
  const requestId='isolated_'+randomBytes(12).toString('hex');
  const admission=await quota.authorizeAIRequest({requestId,userId,providerId,modelId,sessionId:turn.sessionId,conversationId:turn.conversationId,maxTotalTokens:'300'});
  expect(admission.allowed).toBe(true);
  expect((admission as {credentialId:string}).credentialId).toBe(resolved.credentialReference?.id);
  const report={requestId,providerId,status:'success',inputTokens:2,outputTokens:3,durationMs:100};
  expect((await quota.recordAIUsage(report)).replayed).toBe(false);
  expect((await quota.recordAIUsage(report)).replayed).toBe(true);
  await expect(quota.recordAIUsage({...report,outputTokens:4})).rejects.toThrow('USAGE_REPORT_CONFLICT');
  const completion={userId,sessionId:turn.sessionId,requestId,content:'Isolated question',response:'Isolated answer'};
  expect((await ai.completeTurn(completion)).saved).toBe(true);
  expect((await ai.completeTurn(completion)).saved).toBe(true);
  const [m]=await pool.execute<RowDataPacket[]>('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY id',[turn.conversationId]);
  expect(m.map(r=>r.role)).toEqual(['user','assistant']);expect(m).toHaveLength(2);
  const [u]=await pool.execute<RowDataPacket[]>('SELECT input_tokens,output_tokens,status,finalized_at FROM usage_records WHERE request_id=?',[requestId]);
  expect(u).toHaveLength(1);expect(u[0]).toMatchObject({input_tokens:2,output_tokens:3,status:'success'});expect(u[0].finalized_at).not.toBeNull();
 });
 it('does not write messages for an unsettled execution',async()=>{
  const turn=await ai.startTurn({userId,channel:'web'});
  await expect(ai.completeTurn({userId,sessionId:turn.sessionId,requestId:'missing_'+randomBytes(12).toString('hex'),content:'Q',response:'A'})).rejects.toThrow('USAGE_NOT_SETTLED');
  const [m]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?',[turn.conversationId]);expect(Number(m[0].n)).toBe(0);
 });
});
