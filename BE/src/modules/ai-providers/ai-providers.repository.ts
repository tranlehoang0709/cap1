import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { UsersRepository } from '../users/users.repository';
import { OwnershipTransaction } from '../devices/ownership.repository';
import { Owner, Profile, Scope } from './ai.dto';

@Injectable()
export class AiProvidersRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async transaction<T>(work: (tx: AITransaction) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await c.beginTransaction();
      try { const result = await work(new AITransaction(this.pool, c)); await c.commit(); return result; }
      catch (error) { try { await c.rollback(); } catch (rollback) { throw new AggregateError([error, rollback]); } throw error; }
    } finally { c.release(); }
  }
}

export interface Provider { id: string; code: string; name: string; isEnabled: number }
export interface Model { id: string; providerId: string; modelCode: string; capability: string; isEnabled: number }
export interface Credential { id: string; providerId: string; label: string; secretHint: string | null; isActive: number; secretCiphertext?: string }
export class AITransaction {
  readonly users: UsersRepository;
  readonly ownership: OwnershipTransaction;
  constructor(pool: Pool, private readonly connection: PoolConnection) {
    this.users = new UsersRepository(pool, connection);
    this.ownership = new OwnershipTransaction(pool, connection);
  }
  async rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(sql, values as never[]); return rows as T[];
  }
  async provider(id: string) { return (await this.rows<Provider>('SELECT CAST(id AS CHAR) AS id,code,name,is_enabled AS isEnabled FROM ai_providers WHERE id=? FOR UPDATE', [id]))[0] ?? null; }
  providers() { return this.rows<Provider>('SELECT CAST(id AS CHAR) AS id,code,name,is_enabled AS isEnabled FROM ai_providers WHERE is_enabled=1 ORDER BY id'); }
  async model(id: string) { return (await this.rows<Model>('SELECT CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,model_code AS modelCode,capability,is_enabled AS isEnabled FROM ai_models WHERE id=? FOR UPDATE', [id]))[0] ?? null; }
  models(providerId: string) { return this.rows<Model>('SELECT CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,model_code AS modelCode,capability,is_enabled AS isEnabled FROM ai_models WHERE provider_id=? AND is_enabled=1 ORDER BY id', [providerId]); }
  async profile(userId: string) {
    return (await this.rows<Profile>(`SELECT assistant_name AS assistantName,system_prompt AS systemPrompt,
      CAST(preferred_provider_id AS CHAR) AS preferredProviderId,CAST(preferred_llm_model_id AS CHAR) AS preferredLlmModelId,
      language_code AS languageCode,voice_code AS voiceCode FROM ai_profiles WHERE user_id=? FOR UPDATE`, [userId]))[0] ?? null;
  }
  async setting(key: string): Promise<unknown> {
    const row = (await this.rows<{value: unknown}>('SELECT setting_value AS value FROM system_settings WHERE setting_key=? FOR UPDATE', [key]))[0];
    return row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : null;
  }
  async scope(userId: string): Promise<Scope> {
    const value = await this.setting(`ai.user.${userId}.credentialScope`);
    if (value === null || value === 'USER') return 'USER';
    if (value === 'SYSTEM') return 'SYSTEM';
    throw new Error('Invalid stored credential scope');
  }
  async activeCredential(owner: Owner, providerId: string) {
    const rows = await this.rows<Credential>(`SELECT CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,
      secret_ciphertext AS secretCiphertext FROM api_credentials WHERE owner_scope=? AND owner_user_id <=> ?
      AND provider_id=? AND is_active=1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [owner.scope, owner.userId, providerId]);
    return rows[0] ?? null;
  }
  credentials(owner: Owner) { return this.rows<Credential>(`SELECT CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,
    label,secret_hint AS secretHint,is_active AS isActive FROM api_credentials WHERE owner_scope=? AND owner_user_id <=> ? ORDER BY id`, [owner.scope, owner.userId]); }
  async credential(owner: Owner, id: string) { return (await this.rows<Credential>(`SELECT CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,
    label,secret_hint AS secretHint,is_active AS isActive FROM api_credentials WHERE id=? AND owner_scope=? AND owner_user_id <=> ? FOR UPDATE`, [id, owner.scope, owner.userId]))[0] ?? null; }
  async saveProfile(userId: string, p: Profile) {
    await this.rows(`INSERT INTO ai_profiles(user_id,assistant_name,system_prompt,preferred_provider_id,preferred_llm_model_id,language_code,voice_code,updated_at)
      VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE assistant_name=VALUES(assistant_name),system_prompt=VALUES(system_prompt),
      preferred_provider_id=VALUES(preferred_provider_id),preferred_llm_model_id=VALUES(preferred_llm_model_id),language_code=VALUES(language_code),voice_code=VALUES(voice_code),updated_at=UTC_TIMESTAMP()`,
    [userId,p.assistantName,p.systemPrompt,p.preferredProviderId,p.preferredLlmModelId,p.languageCode,p.voiceCode]);
  }
  async saveSetting(key: string, value: unknown, actor: string) { await this.rows(`INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at)
    VALUES(?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP()`, [key, JSON.stringify(value), actor]); }
  async updateProvider(id: string, enabled: boolean) { await this.rows('UPDATE ai_providers SET is_enabled=? WHERE id=?', [enabled, id]); }
  async insertCredential(owner: Owner, providerId: string, label: string, ciphertext: string) {
    await this.rows(`INSERT INTO api_credentials(provider_id,owner_scope,owner_user_id,label,secret_ciphertext,secret_hint,is_active,created_at)
      VALUES(?,?,?,?,?,'configured',1,UTC_TIMESTAMP())`, [providerId,owner.scope,owner.userId,label,ciphertext]);
    return (await this.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
  }
  async replaceCredential(owner: Owner, id: string, label: string, ciphertext: string) { await this.rows(`UPDATE api_credentials SET label=?,secret_ciphertext=?,secret_hint='configured'
    WHERE id=? AND owner_scope=? AND owner_user_id <=> ? AND is_active=1 AND revoked_at IS NULL`, [label,ciphertext,id,owner.scope,owner.userId]); }
  async revokeCredential(owner: Owner, id: string) { await this.rows('UPDATE api_credentials SET is_active=0,revoked_at=UTC_TIMESTAMP() WHERE id=? AND owner_scope=? AND owner_user_id <=> ?', [id,owner.scope,owner.userId]); }
  async audit(actor: string | null, action: string, entityId: string | null, metadata: unknown) {
    await this.rows("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata,occurred_at) VALUES(?,?,'AI_CONFIGURATION',?,?,UTC_TIMESTAMP())", [actor,action,entityId,JSON.stringify(metadata)]);
  }
}
