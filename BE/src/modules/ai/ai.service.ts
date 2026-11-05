import { BadRequestException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AiRepository, ProfileInput, PROFILE_FIELDS } from './ai.repository';
import { AIWebChatClient } from '../web-chat/ai-web-chat.client';
import { AiServiceError } from './ai.errors';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';

@Injectable()
export class AiService {
  constructor(private readonly repo: AiRepository, private readonly cipher: SecretCipherService, @Optional() private readonly gateway?: AIWebChatClient) {}
  providers(){return this.repo.providers();}
  async models(providerId:string){
    if(!/^[1-9][0-9]{0,18}$/.test(providerId) || BigInt(providerId)>9223372036854775807n)
      throw new BadRequestException('Invalid provider ID');
    if(!await this.repo.provider(providerId))throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');
    return this.repo.models(providerId);
  }
  async setProvider(id:string, enabled:boolean, health:string|null){const p=await this.repo.setProvider(id,enabled,health);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');return p;}
  async profile(userId:string){return (await this.repo.profile(userId)) ?? {user_id:userId,assistant_name:'Xiaozhi',system_prompt:null,language_code:'vi',voice_code:null,preferred_provider_id:null,preferred_llm_model_id:null};}
  async updateProfile(userId:string,input:ProfileInput){
    if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).some(key=>!PROFILE_FIELDS.includes(key as typeof PROFILE_FIELDS[number])))
      throw new BadRequestException('Invalid profile fields');
    const keys=PROFILE_FIELDS.filter(key=>input[key]!==undefined);
    if(!keys.length)throw new BadRequestException('At least one profile field is required');
    const limits:Record<string,number>={assistant_name:100,system_prompt:8000,language_code:20,voice_code:100};
    const patch:ProfileInput={};
    for(const key of keys){
      const value=input[key];
      if(value!==null&&(typeof value!=='string'||(limits[key]!==undefined&&value.length>limits[key])))
        throw new BadRequestException('Invalid profile value');
      if(key.startsWith('preferred_')&&value!==null&&
        (!/^[1-9][0-9]{0,18}$/.test(value!)||BigInt(value!)>9223372036854775807n))
        throw new BadRequestException('Invalid profile identifier');
      patch[key]=value;
    }
    try {
      return await this.repo.patchProfile(userId,patch,async(effective,repository)=>{
        if(!keys.some(key=>key.startsWith('preferred_')))return;
        const providerId=effective.preferred_provider_id;
        const modelId=effective.preferred_llm_model_id;
        if(providerId){
          const provider=await repository.provider(providerId);
          if(!provider||!provider.is_enabled)throw new AiServiceError('PROVIDER_UNAVAILABLE','Preferred provider is unavailable');
        }
        if(modelId){
          const model=await repository.model(modelId);
          if(!providerId||!model||model.provider_id!==providerId||!model.is_enabled||model.capability.toUpperCase()!=='LLM')
            throw new AiServiceError('PROFILE_MODEL_CONFLICT','Preferred model is incompatible with provider');
        }
      });
    }catch(error){
      if(error instanceof AiServiceError||error instanceof BadRequestException)throw error;
      throw new AiServiceError('DATABASE_ERROR','Profile could not be saved');
    }
  }
  async addKey(userId:string,providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createCredential(providerId,userId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),secret_hint:`****${secret.slice(-4)}`};}
  keys(userId:string){return this.repo.listCredentials(userId);}
  systemKeys(){return this.repo.listSystemCredentials();}
  async addSystemKey(providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createSystemCredential(providerId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),provider_id:providerId,secret_hint:`****${secret.slice(-4)}`};}
  async revokeSystemKey(id:string){if(!await this.repo.revokeSystemCredential(id))throw new AiServiceError('API_KEY_NOT_FOUND','System API key was not found');return {success:true};}
  async revokeKey(userId:string,id:string){if(!await this.repo.revokeCredential(id,userId))throw new AiServiceError('API_KEY_NOT_FOUND','API key was not found');return {success:true};}
  async chat(userId:string,content:string) {
    if (!this.gateway) throw new ServiceUnavailableException('AI_SERVER_NOT_CONFIGURED');
    const result = await this.gateway.send(userId, content);
    // AI owns admission, actual usage settlement and turn persistence. Never create a second ledger row.
    const conversation = await this.repo.conversation(result.conversation_id, userId);
    if (!conversation || !conversation.messages.some(message => message.role === 'assistant' && message.content === result.content)) {
      throw new ServiceUnavailableException('AI_TURN_NOT_PERSISTED');
    }
    return conversation;
  }
  conversations(userId:string,page:number,limit:number){return this.repo.conversations(userId,page,limit);}
  quotas(userId:string|null){return this.repo.quotas(userId);}
  usage(userId:string,from:Date,to:Date){return this.repo.usageSummary(userId,from,to);}
  setQuota(userId:string|null,providerId:string|null,rpm:number|null,rpd:number|null,monthly:string|null){return this.repo.upsertQuota(userId,providerId,rpm,rpd,monthly);}
  async deactivateQuota(id:string){if(!await this.repo.deactivateQuota(id))throw new AiServiceError('QUOTA_NOT_FOUND','Quota policy was not found');return {success:true};}
  async conversation(userId:string,id:string){const c=await this.repo.conversation(id,userId);if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return c;}
  async deleteConversation(userId:string,id:string){if(!await this.repo.deleteConversation(id,userId))throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return {success:true};}
}
