import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRepository, ProfileInput } from './ai.repository';
import { AiServiceError } from './ai.errors';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';

@Injectable()
export class AiService {
  constructor(private readonly repo: AiRepository, private readonly cipher: SecretCipherService,
    private readonly config: ConfigService = new ConfigService()) {}
  providers(){return this.repo.providers();}
  async setProvider(id:string, enabled:boolean, health:string|null){const p=await this.repo.setProvider(id,enabled,health);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');return p;}
  async profile(userId:string){return (await this.repo.profile(userId)) ?? {user_id:userId,assistant_name:'Xiaozhi',system_prompt:null,language_code:'vi',voice_code:null,preferred_provider_id:null,preferred_llm_model_id:null};}
  async updateProfile(userId:string,input:ProfileInput){if(input.preferred_provider_id){const p=await this.repo.providerEnabled(input.preferred_provider_id);if(!p||!p.is_enabled)throw new AiServiceError('PROVIDER_UNAVAILABLE','Preferred provider is unavailable');} const saved=await this.repo.upsertProfile(userId,input); if(!saved)throw new AiServiceError('DATABASE_ERROR','Profile could not be saved');return saved;}
  async addKey(userId:string,providerId:string,label:string,secret:string){const p=await this.repo.providerEnabled(providerId);if(!p)throw new AiServiceError('PROVIDER_NOT_FOUND','Provider was not found');const id=await this.repo.createCredential(providerId,userId,label.trim(),this.cipher.encrypt(secret),secret.slice(-4));return {id,label:label.trim(),secret_hint:`****${secret.slice(-4)}`};}
  keys(userId:string){return this.repo.listCredentials(userId);}
  async revokeKey(userId:string,id:string){if(!await this.repo.revokeCredential(id,userId))throw new AiServiceError('API_KEY_NOT_FOUND','API key was not found');return {success:true};}
  async chat(userId:string,content:string,providerId:string) {
    const token=this.config.get<string>('AI_SERVER_WEB_TOKEN');
    const origin=this.config.get<string>('AI_SERVER_URL');
    if(!origin||!token||token.length<43)throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','AI Server is not configured');
    const url=new URL(origin);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
      (url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','Invalid AI Server origin');
    try {
      const result=await fetch(new URL('/internal/web-chat',url),{method:'POST',redirect:'error',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({userId,providerId,content}),signal:AbortSignal.timeout(95000)});
      if(!result.ok) {await result.body?.cancel();throw new HttpException('AI_REQUEST_FAILED', [400,403,404,409,429].includes(result.status)?result.status:503);}
      if(!result.headers.get('content-type')?.startsWith('application/json')||!result.body)throw new Error();
      const reader=result.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new Error();chunks.push(value);}}
      finally {await reader.cancel();}
      const text=Buffer.concat(chunks).toString('utf8');
      const data=JSON.parse(text) as {content?:unknown;conversation_id?:unknown;usage?:unknown};
      const usage=data.usage as {input_tokens?:unknown;output_tokens?:unknown}|undefined;
      if(typeof data.content!=='string'||[...data.content].length>500||typeof data.conversation_id!=='string'||!/^[1-9][0-9]*$/.test(data.conversation_id)||!usage||
        !Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens)||Number(usage.input_tokens)<0||Number(usage.output_tokens)<0)throw new Error();
      return {content:data.content,conversation_id:data.conversation_id,usage:{input_tokens:usage.input_tokens,output_tokens:usage.output_tokens}};
    } catch(e) {
      if(e instanceof HttpException)throw e;
      throw new AiServiceError('AI_PIPELINE_UNAVAILABLE','AI Server could not complete the request');
    }
  }
  conversations(userId:string,page:number,limit:number){return this.repo.conversations(userId,page,limit);}
  quotas(userId:string|null){return this.repo.quotas(userId);}
  setQuota(userId:string|null,providerId:string|null,rpm:number|null,rpd:number|null,monthly:string|null){return this.repo.upsertQuota(userId,providerId,rpm,rpd,monthly);}
  async conversation(userId:string,id:string){const c=await this.repo.conversation(id,userId);if(!c)throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return c;}
  async deleteConversation(userId:string,id:string){if(!await this.repo.deleteConversation(id,userId))throw new AiServiceError('CONVERSATION_NOT_FOUND','Conversation was not found');return {success:true};}
}
