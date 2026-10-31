import { ConflictException,ForbiddenException,HttpException,Injectable,InternalServerErrorException,NotFoundException,BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/access-role.guard';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { AITransaction,AiProvidersRepository,Credential,Provider } from './ai-providers.repository';
import { Owner,Scope,Profile,id,objectInput,profileFields,profileInput,secretInput,text } from './ai.dto';

@Injectable()
export class AiProvidersService {
  constructor(private readonly repository:AiProvidersRepository,private readonly encryption:SecretEncryptionService,private readonly config:ConfigService){}
  private role(actor:CurrentUser,role?:'ADMIN'|'USER'){
    if(!actor||!['ADMIN','USER'].includes(actor.role)||(role&&actor.role!==role))throw new ForbiddenException('Required role missing');
    id(actor.userId);
  }
  private async authorize(tx:AITransaction,actor:CurrentUser){
    const user=await tx.users.findByIdForUpdate(actor.userId);const roles=user?await tx.users.findUserRoles(actor.userId):[];
    if(!user||user.status!=='active'||user.email_verified_at===null||roles.length!==1||roles[0].code!==actor.role)throw new ForbiddenException('Active verified account required');
  }
  private async run<T>(actor:CurrentUser,work:(tx:AITransaction)=>Promise<T>):Promise<T>{
    this.role(actor);
    return this.errors(()=>this.repository.transaction(async tx=>{await this.authorize(tx,actor);return work(tx);}));
  }
  private async errors<T>(work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof HttpException)throw error;
      if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY'].includes((error as {code?:string})?.code??''))throw new ConflictException('AI_CONFIGURATION_CONFLICT');
      throw new InternalServerErrorException('AI_CONFIGURATION_UNAVAILABLE');}
  }
  async validateProviderAccess(tx:AITransaction,providerId:string):Promise<Provider>{
    const provider=await tx.provider(providerId);
    if(!provider)throw new NotFoundException('Provider not found');
    if(!provider.isEnabled||!['LOCAL','OPENAI','GEMINI'].includes(provider.code))throw new ForbiddenException('PROVIDER_UNAVAILABLE');
    return provider;
  }
  /** Transaction-scoped permission resolution shared by quota admission. */
  async checkProviderPermission(tx:AITransaction,userId:string,providerId:string,modelId:string){
    const provider=await this.validateProviderAccess(tx,providerId);
    const model=await this.model(tx,providerId,modelId);
    const credential=await this.resolveCredentialScope(tx,userId,provider,await tx.scope(userId));
    return {provider,model,...credential};
  }
  private async model(tx:AITransaction,providerId:string,modelId:string){
    const model=await tx.model(modelId);
    if(!model||!model.isEnabled||model.providerId!==providerId||model.capability.toLowerCase()!=='llm')throw new ConflictException('MODEL_UNAVAILABLE');
    return model;
  }
  async listAvailableProviders(actor:CurrentUser){return this.run(actor,async tx=>{
    const providers=await tx.providers();const result=[];
    for(const provider of providers){if(!['LOCAL','OPENAI','GEMINI'].includes(provider.code))continue;
      const models=await tx.models(provider.id);
      result.push({...provider,isEnabled:!!provider.isEnabled,models:models.filter(m=>m.capability.toLowerCase()==='llm').map(m=>({id:m.id,modelCode:m.modelCode,capability:m.capability}))});}
    return {providers:result};
  });}
  async updateProviderSettings(actor:CurrentUser,input:unknown,body:unknown){
    this.role(actor,'ADMIN');const providerId=id(input);const data=objectInput(body,['isEnabled','defaultLlmModelId'],true);
    if(data.isEnabled!==undefined&&typeof data.isEnabled!=='boolean')throw new BadRequestException('isEnabled must be boolean');
    const defaultId=data.defaultLlmModelId===undefined?undefined:data.defaultLlmModelId===null?null:id(data.defaultLlmModelId);
    return this.run(actor,async tx=>{
      const provider=await tx.provider(providerId);if(!provider)throw new NotFoundException('Provider not found');
      if(defaultId)await this.model(tx,providerId,defaultId);
      if(defaultId!==undefined)await tx.saveSetting(`ai.provider.${providerId}.defaults`,{defaultLlmModelId:defaultId},actor.userId);
      if(data.isEnabled!==undefined)await tx.updateProvider(providerId,data.isEnabled as boolean);
      await tx.audit(actor.userId,'AI_PROVIDER_UPDATED',providerId,{isEnabled:data.isEnabled===undefined?!!provider.isEnabled:data.isEnabled as boolean,defaultLlmModelId:defaultId??null});
      return {...provider,isEnabled:data.isEnabled===undefined?!!provider.isEnabled:data.isEnabled};
    });
  }
  private owner(actor:CurrentUser,scope:Scope):Owner{
    this.role(actor,scope==='SYSTEM'?'ADMIN':'USER');return {scope,userId:scope==='SYSTEM'?null:actor.userId};
  }
  private metadata(key:Credential){return {id:key.id,providerId:key.providerId,label:key.label,secretHint:key.secretHint,isActive:!!key.isActive};}
  private context(owner:Owner,providerId:string){return `${owner.scope}:${owner.userId??'-'}:${providerId}`;}
  async listCredentialMetadata(actor:CurrentUser,scope:Scope){const owner=this.owner(actor,scope);return this.run(actor,async tx=>({credentials:(await tx.credentials(owner)).map(k=>this.metadata(k))}));}
  async saveApiCredential(actor:CurrentUser,scope:Scope,body:unknown,replaceId?:unknown){
    const owner=this.owner(actor,scope);const replacing=replaceId!==undefined;const credentialId=replacing?id(replaceId):undefined;
    const input=objectInput(body,replacing?['label','secret']:['providerId','label','secret']);
    const secret=secretInput(input.secret);const label=text(input.label,100)!;
    const providerId=replacing?undefined:id(input.providerId);
    return this.run(actor,async tx=>{
      let existing=credentialId?await tx.credential(owner,credentialId,false):null;
      if(credentialId&&!existing)throw new NotFoundException('Credential not found');
      if(existing&&!existing.isActive)throw new ConflictException('CREDENTIAL_REVOKED');
      const provider=await this.validateProviderAccess(tx,existing?.providerId??providerId!);
      if(credentialId){existing=await tx.credential(owner,credentialId);
        if(!existing||!existing.isActive||existing.providerId!==provider.id)throw new ConflictException('CREDENTIAL_REVOKED');}
      if(provider.code==='LOCAL')throw new ConflictException('LOCAL_REQUIRES_NO_KEY');
      const ciphertext=this.encryption.encrypt(secret,this.context(owner,provider.id));
      const hint='configured';
      const savedId=credentialId??await tx.insertCredential(owner,provider.id,label,ciphertext,hint);
      if(credentialId)await tx.replaceCredential(owner,credentialId,label,ciphertext,hint);
      await tx.audit(actor.userId,credentialId?'AI_CREDENTIAL_REPLACED':'AI_CREDENTIAL_CREATED',savedId,{providerId:provider.id,scope});
      return {id:savedId,providerId:provider.id,label,secretHint:hint,isActive:true};
    });
  }
  async revokeApiCredential(actor:CurrentUser,scope:Scope,input:unknown){
    const owner=this.owner(actor,scope);const credentialId=id(input);
    return this.run(actor,async tx=>{
      const key=await tx.credential(owner,credentialId);if(!key)throw new NotFoundException('Credential not found');
      if(key.isActive){await tx.revokeCredential(owner,credentialId);await tx.audit(actor.userId,'AI_CREDENTIAL_REVOKED',credentialId,{providerId:key.providerId,scope});}
      return {id:credentialId,isActive:false};
    });
  }
  private scopeAllowed(userId:string,scope:Scope){
    if(!['USER','SYSTEM'].includes(scope))throw new ConflictException('INVALID_CREDENTIAL_SCOPE');
    if(scope==='SYSTEM'&&!(this.config.get<string>('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS')??'').split(',').map(v=>v.trim()).includes(userId))throw new ForbiddenException('SYSTEM_SCOPE_NOT_ALLOWED');
  }
  async resolveCredentialScope(tx:AITransaction,userId:string,provider:Provider,scope:Scope){
    if(provider.code==='LOCAL')return {credentialScope:'NONE' as const,credentialReference:null};
    this.scopeAllowed(userId,scope);
    const owner:Owner={scope,userId:scope==='USER'?userId:null};
    const key=await tx.activeCredential(owner,provider.id);
    if(!key?.secretCiphertext)throw new ConflictException('CREDENTIAL_REQUIRED');
    // Validate integrity at resolution, but never return plaintext through this contract.
    secretInput(this.encryption.decrypt(key.secretCiphertext,this.context(owner,provider.id)));
    return {credentialScope:scope,credentialReference:{id:key.id,providerId:provider.id}};
  }
  async getAIProfile(actor:CurrentUser){this.role(actor,'USER');return this.run(actor,async tx=>{
    const profile=await tx.profile(actor.userId);return {...profile,credentialScope:await tx.scope(actor.userId)};
  });}
  private async selection(tx:AITransaction,userId:string,profile:Profile,scope:Scope){
    if(!['USER','SYSTEM'].includes(scope))throw new ConflictException('INVALID_CREDENTIAL_SCOPE');
    if(!profile.preferredProviderId){this.scopeAllowed(userId,scope);if(profile.preferredLlmModelId)throw new BadRequestException('Provider required for model');return null;}
    const provider=await this.validateProviderAccess(tx,profile.preferredProviderId);
    let modelId=profile.preferredLlmModelId;
    if(!modelId){const defaults=await tx.setting(`ai.provider.${provider.id}.defaults`) as {defaultLlmModelId?:string}|null;modelId=defaults?.defaultLlmModelId??null;}
    if(!modelId)throw new ConflictException('MODEL_REQUIRED');
    const model=await this.model(tx,provider.id,modelId);
    const credentials=await this.resolveCredentialScope(tx,userId,provider,scope);
    return {provider,model,...credentials};
  }
  async updateAIProfile(actor:CurrentUser,body:unknown){
    this.role(actor,'USER');const patch=profileInput(body);
    return this.run(actor,async tx=>{
      const current=await tx.profile(actor.userId);const profile={...current};
      for(const key of profileFields)if(patch[key]!==undefined)profile[key]=patch[key]!;
      if(patch.preferredProviderId!==undefined&&patch.preferredProviderId!==current.preferredProviderId&&patch.preferredLlmModelId===undefined)profile.preferredLlmModelId=null;
      const scope=patch.credentialScope??await tx.scope(actor.userId);
      // Explicit SYSTEM opt-in still needs permission, even when the current provider
      // is LOCAL. A stale stored preference must not block moving back to keyless LOCAL.
      if(patch.credentialScope!==undefined)this.scopeAllowed(actor.userId,scope);
      const selected=await this.selection(tx,actor.userId,profile,scope);
      if(selected)profile.preferredLlmModelId=selected.model.id;
      await tx.saveProfile(actor.userId,profile);
      if(patch.credentialScope!==undefined)await tx.saveSetting(`ai.user.${actor.userId}.credentialScope`,scope,actor.userId);
      await tx.audit(actor.userId,'AI_PROFILE_UPDATED',actor.userId,{providerId:profile.preferredProviderId,modelId:profile.preferredLlmModelId,credentialScope:scope});
      return {...profile,credentialScope:scope};
    });
  }
  async resolveAIConfiguration(body:unknown){
    if(this.config.get<string>('AI_CONFIG_CONTRACT_APPROVED')!=='true')throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    const input=objectInput(body,['userId','deviceId']);const userId=id(input.userId);const deviceId=input.deviceId===undefined?undefined:id(input.deviceId);
    return this.errors(()=>this.repository.transaction(async tx=>{
      if(deviceId){
        const device=await tx.ownership.devices.findDeviceById(deviceId);
        const assignment=device?await tx.ownership.devices.getActiveAssignment(deviceId):null;
        if(!assignment||assignment.userId!==userId)throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      }
      await this.authorize(tx,{userId,role:'USER'});
      if(deviceId&&!await tx.ownership.verifyDeviceOwnership(userId,deviceId))throw new ForbiddenException('DEVICE_ACCESS_DENIED');
      const profile=await tx.profile(userId);const scope=await tx.scope(userId);const selected=await this.selection(tx,userId,profile,scope);
      if(!selected)throw new ConflictException('PROFILE_NOT_CONFIGURED');
      return {userId,provider:{id:selected.provider.id,code:selected.provider.code,name:selected.provider.name},
        model:{id:selected.model.id,modelCode:selected.model.modelCode,capability:selected.model.capability},profile,
        credentialScope:selected.credentialScope,credentialReference:selected.credentialReference};
    }));
  }
}
