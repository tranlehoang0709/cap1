import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRepository, ProfileInput } from './ai.repository';
import { AiServiceError } from './ai.errors';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';
import { AuthService } from '../auth/auth.service';
import { randomUUID } from 'node:crypto';
import { Pa08ChatRepository } from './pa08-chat.repository';

@Injectable()
export class AiService {
  constructor(private readonly repo: AiRepository, private readonly cipher: SecretCipherService,
    private readonly config: ConfigService = new ConfigService(), private readonly auth?: AuthService,
    private readonly chats?: Pa08ChatRepository) {}
  providers(){return this.repo.providers();}
  models(providerId:string){return this.repo.models(providerId);}
  adminModels(){return this.repo.allModels();}
  async createModel(providerId:string,modelCode:string,capability:'llm'|'stt'|'tts',enabled:boolean){const p=await this.repo.provider(providerId);if(!p||!['OPENAI','GEMINI','LOCAL'].includes(p.code))throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');return this.repo.createModel(providerId,modelCode,capability,enabled);}
  async updateModel(id:string,input:{model_code?:string;is_enabled?:boolean}){if(input.model_code===undefined&&input.is_enabled===undefined)throw new AiServiceError('INVALID_MODEL_UPDATE','At least one model field is required');const model=await this.repo.updateModel(id,input);if(!model)throw new AiServiceError('MODEL_NOT_FOUND','Model was not found');return model;}
  async setProvider(id:string, enabled:boolean, health:string|null){const p=await this.repo.setProvider(id,enabled,health);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');return p;}
  async profile(userId:string){return (await this.repo.profile(userId)) ?? {user_id:userId,assistant_name:'Xiaozhi',system_prompt:null,language_code:'vi',voice_code:null,preferred_provider_id:null,preferred_llm_model_id:null};}
  async updateProfile(userId:string,input:ProfileInput){if(input.preferred_provider_id){const p=await this.repo.providerEnabled(input.preferred_provider_id);if(!p||!p.is_enabled)throw new AiServiceError('PROVIDER_UNAVAILABLE','Preferred provider is unavailable');if(input.preferred_llm_model_id&&!await this.repo.compatibleModel(input.preferred_llm_model_id,input.preferred_provider_id))throw new AiServiceError('MODEL_UNAVAILABLE','Preferred model does not belong to the selected provider');}else if(input.preferred_llm_model_id)throw new AiServiceError('PROVIDER_UNAVAILABLE','Provider is required for a model'); const saved=await this.repo.upsertProfile(userId,input); if(!saved)throw new AiServiceError('DATABASE_ERROR','Profile could not be saved');return saved;}
  async addKey(userId:string,providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p||!['OPENAI','GEMINI'].includes(p.code))throw new AiServiceError('PROVIDER_NOT_FOUND','Cloud provider was not found');const id=await this.repo.createCredential(providerId,userId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),provider_id:providerId,secret_hint:'configured'};}
  async replaceKey(userId:string,id:string,label:string,secret:string){const key=await this.repo.replaceCredential(id,userId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));if(!key)throw new AiServiceError('API_KEY_NOT_FOUND','Active API key was not found');return {...key,secret_hint:'configured'};}
  keys(userId:string){return this.repo.listCredentials(userId);}
  systemKeys(){return this.repo.listSystemCredentials();}
  async addSystemKey(providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createSystemCredential(providerId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),provider_id:providerId,secret_hint:`****${secret.slice(-4)}`};}
  async revokeSystemKey(id:string){if(!await this.repo.revokeSystemCredential(id))throw new AiServiceError('API_KEY_NOT_FOUND','System API key was not found');return {success:true};}
  async revokeKey(userId:string,id:string){if(!await this.repo.revokeCredential(id,userId))throw new AiServiceError('API_KEY_NOT_FOUND','API key was not found');return {success:true};}
  async chat(userId:string,content:string,providerId?:string,conversationId?:string,requestId?:string) {
    if(!this.auth)throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','Authentication service is unavailable');
    const serviceToken=this.config.get<string>('toolExecution.serviceToken');
    const origin=this.config.get<string>('AI_SERVER_LOCAL_URL')||'http://127.0.0.1:8002';
    if(!serviceToken||serviceToken.length<43)throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','AI tool service authentication is not configured');
    if(!this.chats)throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','Conversation persistence is unavailable');
    const auth=this.auth;
    return this.chats.turn(userId,requestId ?? randomUUID(),content,conversationId,async ({sessionId,history})=>{
    const delegation=await auth.issueToolDelegation(userId,'schedule.query',sessionId);
    try{
      const result=await fetch(new URL('/internal/pa08-chat',origin),{method:'POST',redirect:'error',
        headers:{'X-AI-Tool-Service':serviceToken,'Content-Type':'application/json'},
        body:JSON.stringify({user_id:userId,session_id:sessionId,content,timezone:'Asia/Bangkok',
          delegation:delegation.delegation_token,stream:false,personalize:false,
          ...(history === undefined ? {} : {history})}),signal:AbortSignal.timeout(120000)});
      if(!result.ok){await result.body?.cancel();throw new HttpException('AI_REQUEST_FAILED',[400,401,403,404,409,422,429].includes(result.status)?result.status:503)}
      const data=await result.json() as {content?:unknown;tool?:unknown;grounded?:unknown};
      if(typeof data.content!=='string'||data.content.length>8000)throw new Error();
      return {content:data.content,tool:typeof data.tool==='string'?data.tool:null,grounded:data.grounded===true};
    }catch(error){if(error instanceof HttpException)throw error;throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','Local AI Server could not complete the request')}
    });
  }
  conversations(userId:string,page:number,limit:number){return this.repo.conversations(userId,page,limit);}
  quotas(userId:string|null){return this.repo.quotas(userId);}
  usage(userId:string,from:Date,to:Date){return this.repo.usageSummary(userId,from,to);}
  setQuota(userId:string|null,providerId:string|null,rpm:number|null,rpd:number|null,monthly:string|null){return this.repo.upsertQuota(userId,providerId,rpm,rpd,monthly);}
  async deactivateQuota(id:string){if(!await this.repo.deactivateQuota(id))throw new AiServiceError('QUOTA_NOT_FOUND','Quota policy was not found');return {success:true};}
  async conversation(userId:string,id:string){const c=await this.repo.conversation(id,userId);if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return c;}
  async renameConversation(userId:string,id:string,title:string){const c=await this.repo.renameConversation(id,userId,title.trim());if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return this.repo.conversation(id,userId);}
  async closeConversation(userId:string,id:string){const c=await this.repo.setConversationStatus(id,userId,'ended');if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return this.repo.conversation(id,userId);}
  async resumeConversation(userId:string,id:string){const c=await this.repo.setConversationStatus(id,userId,'active');if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return this.repo.conversation(id,userId);}
  async deleteConversation(userId:string,id:string){if(!await this.repo.deleteConversation(id,userId))throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return {success:true};}
  deleteAllUserAiData(userId:string){return this.repo.deleteAllUserAiData(userId);}
  usageTimeseries(userId:string,from:Date,to:Date){return this.repo.usageTimeseries(userId,from,to);}
}
