import { Injectable } from '@nestjs/common';
import { AiRepository, ProfileInput } from './ai.repository';
import { AiServiceError } from './ai.errors';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';

@Injectable()
export class AiService {
  constructor(private readonly repo: AiRepository, private readonly cipher: SecretCipherService) {}
  providers(){return this.repo.providers();}
  models(providerId:string){return this.repo.models(providerId);}
  async setProvider(id:string, enabled:boolean, health:string|null){const p=await this.repo.setProvider(id,enabled,health);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');return p;}
  async profile(userId:string){return (await this.repo.profile(userId)) ?? {user_id:userId,assistant_name:'Xiaozhi',system_prompt:null,language_code:'vi',voice_code:null,preferred_provider_id:null,preferred_llm_model_id:null};}
  async updateProfile(userId:string,input:ProfileInput){if(input.preferred_provider_id){const p=await this.repo.providerEnabled(input.preferred_provider_id);if(!p||!p.is_enabled)throw new AiServiceError('PROVIDER_UNAVAILABLE','Preferred provider is unavailable');} const saved=await this.repo.upsertProfile(userId,input); if(!saved)throw new AiServiceError('DATABASE_ERROR','Profile could not be saved');return saved;}
  async addKey(userId:string,providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createCredential(providerId,userId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),secret_hint:`****${secret.slice(-4)}`};}
  keys(userId:string){return this.repo.listCredentials(userId);}
  systemKeys(){return this.repo.listSystemCredentials();}
  async addSystemKey(providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createSystemCredential(providerId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),provider_id:providerId,secret_hint:`****${secret.slice(-4)}`};}
  async revokeSystemKey(id:string){if(!await this.repo.revokeSystemCredential(id))throw new AiServiceError('API_KEY_NOT_FOUND','System API key was not found');return {success:true};}
  async revokeKey(userId:string,id:string){if(!await this.repo.revokeCredential(id,userId))throw new AiServiceError('API_KEY_NOT_FOUND','API key was not found');return {success:true};}
  async chat(userId:string,content:string,providerId:string){const p=await this.repo.providerEnabled(providerId);if(!p||!p.is_enabled)throw new AiServiceError('PROVIDER_UNAVAILABLE','Provider is unavailable');const quota=await this.repo.quota(userId,providerId);if(quota){const minute=await this.repo.usageSince(userId,providerId,new Date(Date.now()-60_000));if(quota.requests_per_minute!==null&&minute.requests>=quota.requests_per_minute)throw new AiServiceError('QUOTA_EXCEEDED','Requests-per-minute quota exceeded');const day=await this.repo.usageSince(userId,providerId,new Date(new Date().setHours(0,0,0,0)));if(quota.requests_per_day!==null&&day.requests>=quota.requests_per_day)throw new AiServiceError('QUOTA_EXCEEDED','Requests-per-day quota exceeded');const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);const month=await this.repo.usageSince(userId,providerId,monthStart);if(quota.tokens_per_month!==null&&month.tokens>=Number(quota.tokens_per_month))throw new AiServiceError('QUOTA_EXCEEDED','Monthly token quota exceeded');} const response=`[Mock ${p.name}] ${content.trim()}`;return this.repo.createConversation(userId,content.trim().slice(0,80),providerId,content.trim(),response);}
  conversations(userId:string,page:number,limit:number){return this.repo.conversations(userId,page,limit);}
  quotas(userId:string|null){return this.repo.quotas(userId);}
  usage(userId:string,from:Date,to:Date){return this.repo.usageSummary(userId,from,to);}
  setQuota(userId:string|null,providerId:string|null,rpm:number|null,rpd:number|null,monthly:string|null){return this.repo.upsertQuota(userId,providerId,rpm,rpd,monthly);}
  async deactivateQuota(id:string){if(!await this.repo.deactivateQuota(id))throw new AiServiceError('QUOTA_NOT_FOUND','Quota policy was not found');return {success:true};}
  async conversation(userId:string,id:string){const c=await this.repo.conversation(id,userId);if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return c;}
  async deleteConversation(userId:string,id:string){if(!await this.repo.deleteConversation(id,userId))throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return {success:true};}
}
