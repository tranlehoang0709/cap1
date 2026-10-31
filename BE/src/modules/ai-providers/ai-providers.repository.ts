import { Inject, Injectable } from '@nestjs/common';
import { Pool,PoolConnection,RowDataPacket,ResultSetHeader } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { UsersRepository } from '../users/users.repository';
import { Owner,Profile,Scope,emptyProfile } from './ai.dto';
import { OwnershipTransaction } from '../devices/ownership.repository';

export interface Provider {id:string;code:string;name:string;isEnabled:number|boolean}
export interface Model {id:string;providerId:string;modelCode:string;capability:string;isEnabled:number|boolean}
export interface Credential {id:string;providerId:string;label:string;secretHint:string|null;isActive:number|boolean;secretCiphertext?:string}
const providerColumns='CAST(id AS CHAR) AS id,code,name,is_enabled AS isEnabled';
const modelColumns='CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,model_code AS modelCode,capability,is_enabled AS isEnabled';
const metadata='CAST(id AS CHAR) AS id,CAST(provider_id AS CHAR) AS providerId,label,secret_hint AS secretHint,(is_active=1 AND revoked_at IS NULL) AS isActive';

@Injectable()
export class AiProvidersRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool:Pool){}
  async transaction<T>(work:(tx:AITransaction)=>Promise<T>):Promise<T>{
    const c=await this.pool.getConnection();
    try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      try{const result=await work(new AITransaction(this.pool,c));await c.commit();return result;}
      catch(error){try{await c.rollback();}catch(rollback){throw new AggregateError([error,rollback],'AI rollback failed');}throw error;}
    }finally{c.release();}
  }
}

export class AITransaction {
  readonly users:UsersRepository;
  readonly ownership:OwnershipTransaction;
  constructor(pool:Pool,private readonly c:PoolConnection){this.users=new UsersRepository(pool,c);this.ownership=new OwnershipTransaction(pool,c);}
  private async rows<T>(sql:string,values:unknown[]=[]):Promise<T[]>{const [rows]=await this.c.execute<RowDataPacket[]>(sql,values as never[]);return rows as T[];}
  async providers():Promise<Provider[]>{return this.rows(`SELECT ${providerColumns} FROM ai_providers WHERE is_enabled=1 ORDER BY id`);}
  async provider(providerId:string):Promise<Provider|null>{return (await this.rows<Provider>(`SELECT ${providerColumns} FROM ai_providers WHERE id=? FOR UPDATE`,[providerId]))[0]??null;}
  async models(providerId:string):Promise<Model[]>{return this.rows(`SELECT ${modelColumns} FROM ai_models WHERE provider_id=? AND is_enabled=1 ORDER BY id`,[providerId]);}
  async model(modelId:string):Promise<Model|null>{return (await this.rows<Model>(`SELECT ${modelColumns} FROM ai_models WHERE id=? FOR UPDATE`,[modelId]))[0]??null;}
  async setting(key:string):Promise<unknown>{
    const row=(await this.rows<{value:unknown}>('SELECT setting_value AS value FROM system_settings WHERE setting_key=?',[key]))[0];
    if(!row)return null;return typeof row.value==='string'?JSON.parse(row.value):row.value;
  }
  async saveSetting(key:string,value:unknown,actorId:string):Promise<void>{
    await this.c.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,[key,JSON.stringify(value),actorId]);
  }
  async updateProvider(providerId:string,enabled:boolean):Promise<void>{await this.c.execute('UPDATE ai_providers SET is_enabled=? WHERE id=?',[enabled?1:0,providerId]);}
  async profile(userId:string):Promise<Profile>{
    return (await this.rows<Profile>(`SELECT assistant_name AS assistantName,system_prompt AS systemPrompt,
      CAST(preferred_provider_id AS CHAR) AS preferredProviderId,CAST(preferred_llm_model_id AS CHAR) AS preferredLlmModelId,
      language_code AS languageCode,voice_code AS voiceCode FROM ai_profiles WHERE user_id=? FOR UPDATE`,[userId]))[0]??{...emptyProfile};
  }
  async saveProfile(userId:string,p:Profile):Promise<void>{
    await this.c.execute(`INSERT INTO ai_profiles(user_id,assistant_name,system_prompt,preferred_provider_id,preferred_llm_model_id,language_code,voice_code,updated_at)
      VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE assistant_name=VALUES(assistant_name),system_prompt=VALUES(system_prompt),
      preferred_provider_id=VALUES(preferred_provider_id),preferred_llm_model_id=VALUES(preferred_llm_model_id),
      language_code=VALUES(language_code),voice_code=VALUES(voice_code),updated_at=VALUES(updated_at)`,
    [userId,p.assistantName,p.systemPrompt,p.preferredProviderId,p.preferredLlmModelId,p.languageCode,p.voiceCode]);
  }
  async credentials(owner:Owner):Promise<Credential[]>{return this.rows(`SELECT ${metadata} FROM api_credentials
    WHERE owner_scope=? AND owner_user_id <=> ? ORDER BY id DESC`,[owner.scope,owner.userId]);}
  async credential(owner:Owner,credentialId:string,lock=true):Promise<Credential|null>{return (await this.rows<Credential>(`SELECT ${metadata} FROM api_credentials
    WHERE owner_scope=? AND owner_user_id <=> ? AND id=?${lock?' FOR UPDATE':''}`,[owner.scope,owner.userId,credentialId]))[0]??null;}
  async activeCredential(owner:Owner,providerId:string):Promise<Credential|null>{return (await this.rows<Credential>(`SELECT ${metadata},secret_ciphertext AS secretCiphertext
    FROM api_credentials WHERE owner_scope=? AND owner_user_id <=> ? AND provider_id=? AND is_active=1 AND revoked_at IS NULL
    ORDER BY id DESC LIMIT 1 FOR UPDATE`,[owner.scope,owner.userId,providerId]))[0]??null;}
  async insertCredential(owner:Owner,providerId:string,label:string,ciphertext:string,hint:string):Promise<string>{
    await this.c.execute(`INSERT INTO api_credentials(provider_id,owner_scope,owner_user_id,label,secret_ciphertext,secret_hint,is_active,created_at)
      VALUES(?,?,?,?,?,?,1,UTC_TIMESTAMP())`,[providerId,owner.scope,owner.userId,label,ciphertext,hint]);
    return (await this.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
  }
  async replaceCredential(owner:Owner,credentialId:string,label:string,ciphertext:string,hint:string):Promise<void>{
    await this.c.execute(`UPDATE api_credentials SET label=?,secret_ciphertext=?,secret_hint=?
      WHERE id=? AND owner_scope=? AND owner_user_id <=> ? AND is_active=1 AND revoked_at IS NULL`,[label,ciphertext,hint,credentialId,owner.scope,owner.userId]);
  }
  async revokeCredential(owner:Owner,credentialId:string):Promise<void>{await this.c.execute(`UPDATE api_credentials SET is_active=0,revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP())
    WHERE id=? AND owner_scope=? AND owner_user_id <=> ?`,[credentialId,owner.scope,owner.userId]);}
  async scope(userId:string):Promise<Scope>{const setting=await this.setting(`ai.user.${userId}.credentialScope`);return setting===null?'USER':setting as Scope;}
  async audit(actorId:string,action:string,entityId:string,metadata:Record<string,string|number|boolean|null>):Promise<void>{
    await this.users.insertAuditLog(actorId,action,'AI_CONFIGURATION',entityId,metadata);
  }
}
