import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvidersRepository, AITransaction } from './ai-providers.repository';
import { emptyProfile, id, objectInput, Owner, Profile, profileInput, Scope, secretInput, text } from './ai.dto';
import { CurrentUser } from '../auth/access-role.guard';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { createDecipheriv } from 'node:crypto';

@Injectable()
export class AiProvidersService {
  constructor(private readonly repo: AiProvidersRepository, private readonly crypto: SecretEncryptionService, private readonly config: ConfigService) {}
  async database<T>(work: (tx: AITransaction) => Promise<T>): Promise<T> {
    try { return await this.repo.transaction(work); }
    catch (e) {
      if (e instanceof HttpException) throw e;
      if (['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((e as {code?:string})?.code ?? '')) throw new ConflictException('AI_CONFIGURATION_RETRY');
      throw new InternalServerErrorException('AI_CONFIGURATION_UNAVAILABLE');
    }
  }
  async activeUser(tx: AITransaction, userId: string, role = 'USER') {
    const u = await tx.users.findByIdForUpdate(userId);
    const roles = u ? await tx.users.findUserRoles(userId) : [];
    if (!u || u.status !== 'active' || u.email_verified_at === null || roles.length !== 1 || roles[0].code !== role) throw new ForbiddenException('USER_ACCESS_DENIED');
  }
  private actor(actor: CurrentUser, role: 'USER' | 'ADMIN') {
    if (!actor || actor.role !== role) throw new ForbiddenException('ROLE_REQUIRED');
    return id(actor.userId);
  }
  private systemAllowed(userId: string) {
    if (!(this.config.get<string>('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS') ?? '').split(',').map(v=>v.trim()).includes(userId)) throw new ForbiddenException('SYSTEM_SCOPE_NOT_ALLOWED');
  }
  private async provider(tx: AITransaction, providerId: string) {
    const p = await tx.provider(providerId);
    if (!p) throw new NotFoundException('PROVIDER_UNAVAILABLE');
    if (!p.isEnabled || !['LOCAL','OPENAI','GEMINI'].includes(p.code)) throw new ForbiddenException('PROVIDER_UNAVAILABLE');
    return p;
  }
  private async model(tx: AITransaction, providerId: string, modelId: string | null) {
    if (!modelId) {
      const defaults = await tx.setting(`ai.provider.${providerId}.defaults`) as {defaultLlmModelId?:unknown} | null;
      if (!defaults?.defaultLlmModelId) throw new ConflictException('MODEL_REQUIRED');
      modelId = id(defaults.defaultLlmModelId);
    }
    const m = await tx.model(modelId);
    if (!m || !m.isEnabled || m.providerId !== providerId || m.capability !== 'llm') throw new ConflictException('MODEL_UNAVAILABLE');
    return m;
  }
  private decryptSecret(ciphertext: string | undefined, owner: Owner, providerId: string): string {
    if (!ciphertext) throw new ConflictException('CREDENTIAL_UNAVAILABLE');
    try {
      // Existing public /api-keys writes the four-part APP_ENCRYPTION_KEY envelope.
      // Accept that exact format and the existing context-bound five-part format.
      if (ciphertext.split('.').length === 4) {
        const [version,iv,tag,data] = ciphertext.split('.');
        const key = Buffer.from(this.config.get<string>('crypto.encryptionKey') ?? this.config.get<string>('APP_ENCRYPTION_KEY') ?? '', 'base64url');
        if (version !== 'v1' || key.length !== 32 || Buffer.from(iv,'base64url').length !== 12 || Buffer.from(tag,'base64url').length !== 16) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url')); decipher.setAuthTag(Buffer.from(tag,'base64url'));
        return secretInput(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'));
      } else return secretInput(this.crypto.decrypt(ciphertext,`${owner.scope}:${owner.userId ?? '-'}:${providerId}`));
    } catch { throw new ConflictException('CREDENTIAL_UNAVAILABLE'); }
  }
  async checkProviderPermission(tx: AITransaction, userId: string, providerId: string, modelId: string | null, scope?: Scope) {
    const provider = await this.provider(tx,providerId), model = await this.model(tx,providerId,modelId);
    if (provider.code === 'LOCAL') return {provider,model,credentialScope:'NONE' as const,credentialReference:null};
    scope = scope ?? await tx.scope(userId);
    if (scope === 'SYSTEM') this.systemAllowed(userId);
    const owner: Owner = {scope,userId:scope === 'USER' ? userId : null};
    const credential = await tx.activeCredential(owner,providerId);
    if (!credential) throw new ConflictException('CREDENTIAL_REQUIRED');
    this.decryptSecret(credential.secretCiphertext,owner,providerId);
    return {provider,model,credentialScope:scope,credentialReference:{id:credential.id,providerId}};
  }
  async resolveAIConfiguration(body: unknown) {
    if (this.config.get<string>('AI_CONFIG_CONTRACT_APPROVED') !== 'true') throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    const input = objectInput(body,['userId','deviceId','providerId','modelId','includeCredential']); const userId = id(input.userId);
    const deviceId = input.deviceId === undefined || input.deviceId === null ? null : id(input.deviceId);
    const providerId = input.providerId === undefined || input.providerId === null ? null : id(input.providerId);
    const modelId = input.modelId === undefined || input.modelId === null ? null : id(input.modelId);
    if (input.includeCredential !== undefined && typeof input.includeCredential !== 'boolean') throw new BadRequestException('INVALID_CREDENTIAL_REQUEST');
    return this.database(async tx => {
      await tx.requireApprovedRobot(userId);
      if (deviceId) {
        const d = await tx.ownership.devices.findDeviceById(deviceId);
        const a = d ? await tx.ownership.devices.getActiveAssignment(deviceId) : null;
        if (!a || a.userId !== userId) throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      }
      await this.activeUser(tx,userId);
      if (deviceId && !await tx.ownership.verifyDeviceOwnership(userId,deviceId)) throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      const profile = await tx.profile(userId);
      const selectedProvider = providerId ?? profile?.preferredProviderId ?? null;
      const selectedModel = modelId ?? (providerId && providerId !== profile?.preferredProviderId ? null : profile?.preferredLlmModelId) ?? null;
      if (!selectedProvider) throw new ConflictException('PROVIDER_REQUIRED');
      const p = await this.checkProviderPermission(tx,userId,selectedProvider,selectedModel);
      let credential: string | null = null;
      if (input.includeCredential === true && p.credentialReference) {
        const scope = p.credentialScope as Scope;
        const owner: Owner = {scope,userId:scope === 'USER' ? userId : null};
        const stored = await tx.activeCredential(owner,p.provider.id);
        if (!stored || stored.id !== p.credentialReference.id) throw new ConflictException('CREDENTIAL_UNAVAILABLE');
        credential = this.decryptSecret(stored.secretCiphertext,owner,p.provider.id);
      }
      return {userId,provider:{id:p.provider.id,code:p.provider.code,name:p.provider.name},
        model:{id:p.model.id,modelCode:p.model.modelCode,capability:p.model.capability},profile,
        credentialScope:p.credentialScope,credentialReference:p.credentialReference,...(input.includeCredential === true ? {credential} : {})};
    });
  }
  async listAvailableProviders(actor: CurrentUser) {
    if (!actor || !['USER','ADMIN'].includes(actor.role)) throw new ForbiddenException();
    return this.database(async tx=>{
      await this.activeUser(tx,id(actor.userId),actor.role);
      const providers = [];
      for (const p of await tx.providers()) if (p.isEnabled && ['LOCAL','OPENAI','GEMINI'].includes(p.code)) providers.push({...p,models:(await tx.models(p.id)).filter(m=>m.capability==='llm')});
      return {providers};
    });
  }
  async startTurn(body: unknown) {
    const input=objectInput(body,['userId','deviceId','channel']);
    const userId=id(input.userId),deviceId=input.deviceId==null?null:id(input.deviceId);
    if(!['web','robot'].includes(input.channel as string) || (input.channel==='robot'&&!deviceId) || (input.channel==='web'&&deviceId)) throw new BadRequestException('INVALID_AI_CONTEXT');
    return this.database(async tx=>{
      await this.activeUser(tx,userId);
      if(deviceId)await tx.ownership.devices.findDeviceById(deviceId);
      if(deviceId&&!await tx.ownership.verifyDeviceOwnership(userId,deviceId))throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      await tx.rows("INSERT INTO conversations(user_id,device_id,channel,status,started_at) VALUES(?,?,?,'active',UTC_TIMESTAMP())",[userId,deviceId,input.channel]);
      const conversationId=(await tx.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
      await tx.rows("INSERT INTO ai_sessions(conversation_id,device_id,status,started_at) VALUES(?,?,'active',UTC_TIMESTAMP())",[conversationId,deviceId]);
      const sessionId=(await tx.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
      return {conversationId,sessionId};
    });
  }
  async completeTurn(body: unknown) {
    const input=objectInput(body,['userId','sessionId','requestId','content','response']);
    const userId=id(input.userId),sessionId=id(input.sessionId);
    const content=text(input.content,16000,false,true) as string,response=text(input.response,500,false,true) as string;
    if(typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId))throw new BadRequestException('INVALID_REQUEST_ID');
    return this.database(async tx=>{
      await this.activeUser(tx,userId);
      const s=(await tx.rows<{conversationId:string;status:string;deviceId:string|null}>(`SELECT CAST(s.conversation_id AS CHAR) AS conversationId,s.status,CAST(s.device_id AS CHAR) AS deviceId FROM ai_sessions s JOIN conversations c ON c.id=s.conversation_id WHERE s.id=? AND c.user_id=? AND c.deleted_at IS NULL FOR UPDATE`,[sessionId,userId]))[0];
      if(!s)throw new ForbiddenException('INVALID_AI_CONTEXT');
      if(s.deviceId){
        await tx.ownership.devices.findDeviceById(s.deviceId);
        if(!await tx.ownership.verifyDeviceOwnership(userId,s.deviceId))throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      }
      const usage=(await tx.rows<{providerId:string}>(`SELECT CAST(provider_id AS CHAR) AS providerId FROM usage_records WHERE request_id=? AND user_id=? AND ai_session_id=? AND conversation_id=? AND finalized_at IS NOT NULL AND status='success' FOR UPDATE`,[input.requestId,userId,sessionId,s.conversationId]))[0];
      if(!usage)throw new ConflictException('USAGE_NOT_SETTLED');
      const privacy=(await tx.rows<{save:number}>('SELECT save_history AS save FROM privacy_preferences WHERE user_id=? FOR UPDATE',[userId]))[0];
      const saved=privacy?.save===1;
      if(s.status==='completed') {
        if(saved){const messages=await tx.rows<{role:string;content:string}>('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY id',[s.conversationId]);
          if(messages.length!==2||messages[0].content!==content||messages[1].content!==response)throw new ConflictException('TURN_COMPLETION_CONFLICT');}
        return {conversationId:s.conversationId,sessionId,saved};
      }
      if(s.status!=='active')throw new ConflictException('INVALID_AI_CONTEXT');
      if(saved)await tx.rows("INSERT INTO messages(conversation_id,role,content,provider_id,created_at) VALUES(?,'user',?,?,UTC_TIMESTAMP()),(?,'assistant',?,?,UTC_TIMESTAMP())",[s.conversationId,content,usage.providerId,s.conversationId,response,usage.providerId]);
      await tx.rows("UPDATE ai_sessions SET status='completed',ended_at=UTC_TIMESTAMP() WHERE id=?",[sessionId]);
      await tx.rows("UPDATE conversations SET status='completed',ended_at=UTC_TIMESTAMP() WHERE id=?",[s.conversationId]);
      return {conversationId:s.conversationId,sessionId,saved};
    });
  }
  async getAIProfile(actor: CurrentUser) {
    const userId=this.actor(actor,'USER');
    return this.database(async tx=>{await tx.requireApprovedRobot(userId);await this.activeUser(tx,userId);return {...(await tx.profile(userId) ?? emptyProfile),credentialScope:await tx.scope(userId)};});
  }
  async updateAIProfile(actor: CurrentUser, body: unknown) {
    const userId=this.actor(actor,'USER'),patch=profileInput(body);
    return this.database(async tx=>{
      await tx.requireApprovedRobot(userId);
      await this.activeUser(tx,userId);
      const {credentialScope,...fields}=patch,profile:Profile={...(await tx.profile(userId) ?? emptyProfile),...fields};
      const scope=credentialScope ?? await tx.scope(userId);
      if (credentialScope==='SYSTEM') this.systemAllowed(userId);
      if (profile.preferredProviderId) {const p=await this.checkProviderPermission(tx,userId,profile.preferredProviderId,profile.preferredLlmModelId,scope);profile.preferredLlmModelId=p.model.id;}
      else if (profile.preferredLlmModelId) throw new ConflictException('PROVIDER_REQUIRED');
      await tx.saveProfile(userId,profile);
      if (credentialScope) await tx.saveSetting(`ai.user.${userId}.credentialScope`,scope,userId);
      await tx.audit(userId,'AI_PROFILE_CHANGED',userId,{});
      return {...profile,credentialScope:scope};
    });
  }
  async updateProviderSettings(actor: CurrentUser, providerId: string, body: unknown) {
    const actorId=this.actor(actor,'ADMIN');providerId=id(providerId);const input=objectInput(body,['isEnabled','defaultLlmModelId'],true);
    if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') throw new BadRequestException('Invalid isEnabled');
    return this.database(async tx=>{
      await this.activeUser(tx,actorId,'ADMIN');const p=await tx.provider(providerId);if (!p) throw new NotFoundException();
      if(input.defaultLlmModelId!==undefined){const modelId=id(input.defaultLlmModelId);await this.model(tx,providerId,modelId);await tx.saveSetting(`ai.provider.${providerId}.defaults`,{defaultLlmModelId:modelId},actorId);}
      if(input.isEnabled!==undefined) await tx.updateProvider(providerId,input.isEnabled as boolean);
      await tx.audit(actorId,'AI_PROVIDER_CHANGED',providerId,{});return {id:providerId,isEnabled:input.isEnabled ?? !!p.isEnabled};
    });
  }
  private credentialOwner(actor: CurrentUser, scope: Scope): Owner {const userId=this.actor(actor,scope==='USER'?'USER':'ADMIN');return {scope,userId:scope==='USER'?userId:null};}
  async listCredentialMetadata(actor: CurrentUser, scope: Scope) {
    const owner=this.credentialOwner(actor,scope);
    return this.database(async tx=>{await this.activeUser(tx,actor.userId,actor.role);return {credentials:(await tx.credentials(owner)).map(c=>({id:c.id,providerId:c.providerId,label:c.label,secretHint:'configured',isActive:!!c.isActive}))};});
  }
  async saveApiCredential(actor: CurrentUser, scope: Scope, body: unknown, credentialId?: string) {
    const owner=this.credentialOwner(actor,scope),input=objectInput(body,credentialId?['label','secret']:['providerId','label','secret'],true);
    const label=text(input.label,100) as string,secret=secretInput(input.secret);
    return this.database(async tx=>{
      await this.activeUser(tx,actor.userId,actor.role);
      const old=credentialId ? await tx.credential(owner,id(credentialId)) : null;
      if(credentialId && !old) throw new NotFoundException();if(old && !old.isActive) throw new ConflictException('CREDENTIAL_REVOKED');
      const providerId=old?.providerId ?? id(input.providerId),p=await this.provider(tx,providerId);
      if(p.code==='LOCAL') throw new ConflictException('LOCAL_CREDENTIAL_NOT_ALLOWED');
      const ciphertext=this.crypto.encrypt(secret,`${scope}:${owner.userId??'-'}:${providerId}`);
      const keyId=old?.id ?? await tx.insertCredential(owner,providerId,label,ciphertext);
      if(old) await tx.replaceCredential(owner,old.id,label,ciphertext);
      await tx.audit(actor.userId,'AI_CREDENTIAL_CHANGED',keyId,{providerId,scope});
      return {id:keyId,providerId,label,secretHint:'configured',isActive:true};
    });
  }
  async revokeApiCredential(actor: CurrentUser, scope: Scope, credentialId: string) {
    const owner=this.credentialOwner(actor,scope);credentialId=id(credentialId);
    return this.database(async tx=>{
      await this.activeUser(tx,actor.userId,actor.role);const c=await tx.credential(owner,credentialId);if(!c) throw new NotFoundException();
      if(c.isActive){await tx.revokeCredential(owner,credentialId);await tx.audit(actor.userId,'AI_CREDENTIAL_REVOKED',credentialId,{});}
      return {id:credentialId,isActive:false};
    });
  }
}
