import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';
import { AITransaction,AiProvidersRepository } from '../src/modules/ai-providers/ai-providers.repository';
import { SecretEncryptionService } from '../src/modules/api-keys/secret-encryption.service';
import { emptyProfile,profileInput } from '../src/modules/ai-providers/ai.dto';
import { CurrentUser } from '../src/modules/auth/access-role.guard';

const user:CurrentUser={userId:'7',role:'USER'};const admin:CurrentUser={userId:'1',role:'ADMIN'};
const rawSecret='test-secret-that-must-not-leak';
const owner={scope:'USER' as const,userId:'7'};
function configuration(){return new ConfigService({AI_SECRET_KEY_BASE64:Buffer.alloc(32,4).toString('base64'),AI_SECRET_KEY_ID:'test',
  AI_CONFIG_CONTRACT_APPROVED:'true',AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS:'7'});}

describe('SecretEncryptionService',()=>{
  it('randomizes ciphertext, authenticates context and detects tampering',()=>{
    const e=new SecretEncryptionService(configuration());
    const a=e.encrypt(rawSecret,'USER:7:2');const b=e.encrypt(rawSecret,'USER:7:2');
    expect(a).not.toEqual(b);expect(a).not.toContain(rawSecret);expect(e.decrypt(a,'USER:7:2')).toBe(rawSecret);
    expect(()=>e.decrypt(a,'USER:8:2')).toThrow('CREDENTIAL_UNAVAILABLE');
    expect(()=>e.decrypt(a,'SYSTEM:-:2')).toThrow('CREDENTIAL_UNAVAILABLE');
    const parts=a.split('.');parts[4]=Buffer.from('tampered').toString('base64url');
    expect(()=>e.decrypt(parts.join('.'),'USER:7:2')).toThrow('CREDENTIAL_UNAVAILABLE');
  });
  it('fails closed without a proper encryption key or after unsupported rotation',()=>{
    const e=new SecretEncryptionService(new ConfigService({}));expect(()=>e.encrypt(rawSecret,'USER:7:2')).toThrow('SECRET_ENCRYPTION_NOT_CONFIGURED');
    const old=new SecretEncryptionService(configuration()).encrypt(rawSecret,'USER:7:2');
    const c=configuration();c.set('AI_SECRET_KEY_ID','new');
    expect(()=>new SecretEncryptionService(c).decrypt(old,'USER:7:2')).toThrow('CREDENTIAL_UNAVAILABLE');
  });
});

describe('AI provider/profile/credential service',()=>{
  let service:AiProvidersService;let repo:{transaction:jest.Mock};let tx:any;let config:ConfigService;let crypto:SecretEncryptionService;
  beforeEach(()=>{
    config=configuration();crypto=new SecretEncryptionService(config);
    tx={users:{findByIdForUpdate:jest.fn(async(id:string)=>({id,status:'active',email_verified_at:new Date()})),
      findUserRoles:jest.fn(async(id:string)=>[{code:id==='1'?'ADMIN':'USER'}])},
      provider:jest.fn().mockResolvedValue({id:'2',code:'OPENAI',name:'OpenAI',isEnabled:1}),
      providers:jest.fn().mockResolvedValue([{id:'1',code:'LOCAL',name:'Local',isEnabled:1}]),
      models:jest.fn().mockResolvedValue([{id:'3',modelCode:'llm',capability:'llm',isEnabled:1}]),
      model:jest.fn().mockResolvedValue({id:'3',providerId:'2',modelCode:'gpt-test',capability:'llm',isEnabled:1}),
      setting:jest.fn().mockResolvedValue(null),saveSetting:jest.fn(),updateProvider:jest.fn(),
      profile:jest.fn().mockResolvedValue({...emptyProfile}),saveProfile:jest.fn(),scope:jest.fn().mockResolvedValue('USER'),
      credentials:jest.fn().mockResolvedValue([]),credential:jest.fn().mockResolvedValue({id:'9',providerId:'2',label:'key',secretHint:'configured',isActive:1}),
      activeCredential:jest.fn().mockImplementation(async(o:any)=>({id:'9',providerId:'2',isActive:1,
        secretCiphertext:crypto.encrypt(rawSecret,`${o.scope}:${o.userId??'-'}:2`)})),
      insertCredential:jest.fn().mockResolvedValue('9'),replaceCredential:jest.fn(),revokeCredential:jest.fn(),audit:jest.fn(),
      ownership:{devices:{findDeviceById:jest.fn().mockResolvedValue({id:'42'}),getActiveAssignment:jest.fn().mockResolvedValue({deviceId:'42',userId:'7'})},
        verifyDeviceOwnership:jest.fn().mockResolvedValue({id:'42'})}};
    repo={transaction:jest.fn(async work=>work(tx))};service=new AiProvidersService(repo as unknown as AiProvidersRepository,crypto,config);
  });
  it('lists enabled allowed providers and compatible models',async()=>{
    tx.providers.mockResolvedValue([{id:'1',code:'LOCAL',isEnabled:1},{id:'4',code:'UNKNOWN',isEnabled:1}]);
    tx.models.mockResolvedValue([{id:'3',capability:'llm'},{id:'4',capability:'tts'}]);
    const result=await service.listAvailableProviders(user);expect(result.providers).toHaveLength(1);expect(result.providers[0].models).toHaveLength(1);
  });
  it('Admin configures availability/default model with audit, User cannot',async()=>{
    await expect(service.updateProviderSettings(user,'2',{isEnabled:false})).rejects.toMatchObject({status:403});
    await service.updateProviderSettings(admin,'2',{isEnabled:false,defaultLlmModelId:'3'});
    expect(tx.updateProvider).toHaveBeenCalledWith('2',false);
    expect(tx.saveSetting).toHaveBeenCalledWith('ai.provider.2.defaults',{defaultLlmModelId:'3'},'1');expect(tx.audit).toHaveBeenCalled();
  });
  it.each([{isEnabled:'true'},{unknown:true},{}])('rejects provider patch %j',async body=>{
    await expect(service.updateProviderSettings(admin,'2',body)).rejects.toMatchObject({status:400});
  });
  it.each([null,{id:'2',code:'OPENAI',isEnabled:0},{id:'2',code:'UNKNOWN',isEnabled:1}])('rejects missing/disabled/unsupported provider %j',async provider=>{
    tx.provider.mockResolvedValue(provider);
    await expect(service.updateAIProfile(user,{preferredProviderId:'2',preferredLlmModelId:'3'})).rejects.toMatchObject({status:provider===null?404:403});
  });
  it.each([null,{id:'3',providerId:'9',isEnabled:1,capability:'llm'},
    {id:'3',providerId:'2',isEnabled:0,capability:'llm'},{id:'3',providerId:'2',isEnabled:1,capability:'tts'}])('rejects incompatible model %j',async model=>{
    tx.model.mockResolvedValue(model);
    await expect(service.updateAIProfile(user,{preferredProviderId:'2',preferredLlmModelId:'3'})).rejects.toMatchObject({status:409});
    expect(tx.saveProfile).not.toHaveBeenCalled();
  });
  it('reads absent profile without mutation and scopes create/update to authenticated User',async()=>{
    expect(await service.getAIProfile(user)).toEqual({...emptyProfile,credentialScope:'USER'});expect(tx.saveProfile).not.toHaveBeenCalled();
    const result=await service.updateAIProfile(user,{assistantName:' AIVA ',systemPrompt:'hello\nworld'});
    expect(result.assistantName).toBe('AIVA');expect(tx.saveProfile).toHaveBeenCalledWith('7',expect.objectContaining({systemPrompt:'hello\nworld'}));
    await expect(service.updateAIProfile(user,{userId:'8'})).rejects.toMatchObject({status:400});
  });
  it('supports LOCAL without ever resolving a Cloud credential',async()=>{
    tx.provider.mockResolvedValue({id:'1',code:'LOCAL',isEnabled:1});tx.model.mockResolvedValue({id:'3',providerId:'1',isEnabled:1,capability:'llm'});
    await service.updateAIProfile(user,{preferredProviderId:'1',preferredLlmModelId:'3'});expect(tx.activeCredential).not.toHaveBeenCalled();
  });
  it('allows switching from a revoked SYSTEM permission to LOCAL without requiring a Cloud key',async()=>{
    config.set('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS','');tx.scope.mockResolvedValue('SYSTEM');
    tx.provider.mockResolvedValue({id:'1',code:'LOCAL',isEnabled:1});tx.model.mockResolvedValue({id:'3',providerId:'1',isEnabled:1,capability:'llm'});
    await expect(service.updateAIProfile(user,{preferredProviderId:'1',preferredLlmModelId:'3'})).resolves.toMatchObject({preferredProviderId:'1'});
    expect(tx.activeCredential).not.toHaveBeenCalled();
  });
  it('still requires permission for an explicit new SYSTEM selection on LOCAL',async()=>{
    config.set('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS','');tx.provider.mockResolvedValue({id:'1',code:'LOCAL',isEnabled:1});
    await expect(service.updateAIProfile(user,{preferredProviderId:'1',preferredLlmModelId:'3',credentialScope:'SYSTEM'})).rejects.toMatchObject({status:403});
    expect(tx.saveProfile).not.toHaveBeenCalled();
  });
  it('uses Admin default model when model omitted',async()=>{
    tx.setting.mockResolvedValue({defaultLlmModelId:'3'});
    await service.updateAIProfile(user,{preferredProviderId:'2'});
    expect(tx.saveProfile).toHaveBeenCalledWith('7',expect.objectContaining({preferredLlmModelId:'3'}));
  });
  it('requires valid owned credential and never silently falls back to SYSTEM',async()=>{
    tx.activeCredential.mockResolvedValue(null);
    await expect(service.updateAIProfile(user,{preferredProviderId:'2',preferredLlmModelId:'3'})).rejects.toMatchObject({status:409});
    expect(tx.activeCredential).toHaveBeenCalledTimes(1);expect(tx.activeCredential).toHaveBeenCalledWith(owner,'2');
    tx.activeCredential.mockResolvedValue({id:'9',secretCiphertext:'corrupt'});
    await expect(service.updateAIProfile(user,{preferredProviderId:'2',preferredLlmModelId:'3'})).rejects.toMatchObject({status:409});
  });
  it('quota permission helper reuses provider/model and credential-scope validation on the supplied transaction',async()=>{
    expect(await service.checkProviderPermission(tx,'7','2','3')).toMatchObject({credentialScope:'USER',credentialReference:{id:'9',providerId:'2'}});
    tx.activeCredential.mockResolvedValue(null);await expect(service.checkProviderPermission(tx,'7','2','3')).rejects.toMatchObject({status:409});
    tx.model.mockResolvedValue({id:'3',providerId:'2',capability:'tts',isEnabled:1});await expect(service.checkProviderPermission(tx,'7','2','3')).rejects.toMatchObject({status:409});
  });
  it('requires explicit SYSTEM selection AND permission, then stores choice separately',async()=>{
    config.set('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS','');
    await expect(service.updateAIProfile(user,{credentialScope:'SYSTEM',preferredProviderId:'2',preferredLlmModelId:'3'})).rejects.toMatchObject({status:403});
    config.set('AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS','7');
    await service.updateAIProfile(user,{credentialScope:'SYSTEM',preferredProviderId:'2',preferredLlmModelId:'3'});
    expect(tx.activeCredential).toHaveBeenCalledWith({scope:'SYSTEM',userId:null},'2');
    expect(tx.saveSetting).toHaveBeenCalledWith('ai.user.7.credentialScope','SYSTEM','7');
  });
  it('encrypts personal keys and returns only redacted metadata; audit has no secret',async()=>{
    const result=await service.saveApiCredential(user,'USER',{providerId:'2',label:'key',secret:rawSecret});
    expect(result).toEqual({id:'9',providerId:'2',label:'key',secretHint:'configured',isActive:true});
    const [storedOwner,providerId,label,ciphertext]=tx.insertCredential.mock.calls[0];
    expect(storedOwner).toEqual(owner);expect(providerId).toBe('2');expect(label).toBe('key');expect(ciphertext).not.toContain(rawSecret);
    expect(crypto.decrypt(ciphertext,'USER:7:2')).toBe(rawSecret);
    expect(JSON.stringify(tx.audit.mock.calls)).not.toContain(rawSecret);
  });
  it('keeps SYSTEM and USER operations separate and hides another User key',async()=>{
    await expect(service.saveApiCredential(user,'SYSTEM',{providerId:'2',label:'key',secret:rawSecret})).rejects.toMatchObject({status:403});
    await service.listCredentialMetadata(admin,'SYSTEM');expect(tx.credentials).toHaveBeenCalledWith({scope:'SYSTEM',userId:null});
    tx.credential.mockResolvedValue(null);
    await expect(service.revokeApiCredential(user,'USER','99')).rejects.toMatchObject({status:404});
    expect(tx.credential).toHaveBeenCalledWith(owner,'99');
  });
  it('replaces active key without changing provider/scope; revokes idempotently with audit',async()=>{
    await service.saveApiCredential(user,'USER',{label:'new',secret:rawSecret},'9');expect(tx.replaceCredential).toHaveBeenCalled();
    await service.revokeApiCredential(user,'USER','9');expect(tx.revokeCredential).toHaveBeenCalledWith(owner,'9');
    tx.credential.mockResolvedValue({id:'9',providerId:'2',isActive:0});
    await expect(service.saveApiCredential(user,'USER',{label:'new',secret:rawSecret},'9')).rejects.toMatchObject({status:409});
    tx.audit.mockClear();await service.revokeApiCredential(user,'USER','9');expect(tx.audit).not.toHaveBeenCalled();
  });
  it.each(['','short','white space secret',123,null])('rejects malformed secret %j',async secret=>{
    await expect(service.saveApiCredential(user,'USER',{providerId:'2',label:'key',secret})).rejects.toMatchObject({status:400});
  });
  it('rejects Cloud keys for LOCAL provider',async()=>{
    tx.provider.mockResolvedValue({id:'1',code:'LOCAL',isEnabled:1});
    await expect(service.saveApiCredential(user,'USER',{providerId:'1',label:'key',secret:rawSecret})).rejects.toMatchObject({status:409});
  });
  it('internal resolve returns correct User persona and references only',async()=>{
    tx.profile.mockResolvedValue({...emptyProfile,assistantName:'Mine',preferredProviderId:'2',preferredLlmModelId:'3'});
    const result=await service.resolveAIConfiguration({userId:'7',deviceId:'42'});
    expect(result).toMatchObject({userId:'7',profile:{assistantName:'Mine'},credentialScope:'USER',credentialReference:{id:'9'}});
    expect(JSON.stringify(result)).not.toMatch(/secret|ciphertext/);expect(tx.ownership.verifyDeviceOwnership).toHaveBeenCalledWith('7','42');
  });
  it('internal contract fails closed and rejects unauthorized devices/users',async()=>{
    config.set('AI_CONFIG_CONTRACT_APPROVED','false');
    await expect(service.resolveAIConfiguration({userId:'7'})).rejects.toMatchObject({status:403});
    config.set('AI_CONFIG_CONTRACT_APPROVED','true');tx.ownership.devices.getActiveAssignment.mockResolvedValue({userId:'8'});
    await expect(service.resolveAIConfiguration({userId:'7',deviceId:'42'})).rejects.toMatchObject({status:403});
    tx.users.findByIdForUpdate.mockResolvedValue({status:'disabled',email_verified_at:null});
    await expect(service.resolveAIConfiguration({userId:'7'})).rejects.toMatchObject({status:403});
  });
  it('propagates audit failure and maps database failures safely',async()=>{
    tx.audit.mockRejectedValue(new Error('secret SQL'));
    await expect(service.updateProviderSettings(admin,'2',{isEnabled:false})).rejects.toMatchObject({status:500,message:'AI_CONFIGURATION_UNAVAILABLE'});
    repo.transaction.mockRejectedValue({code:'ER_LOCK_DEADLOCK'});
    await expect(service.getAIProfile(user)).rejects.toMatchObject({status:409});
  });
  it.each([{assistantName:'x'.repeat(101)},{systemPrompt:'\u0000'}, {voiceCode:123},{credentialScope:'NONE'},
    {preferredProviderId:'0'},{preferredLlmModelId:'bad'},{}])('rejects invalid personalization %j',body=>{
    expect(()=>profileInput(body)).toThrow();
  });
});

describe('AI repository isolation and transaction handling',()=>{
  let c:any;let repository:AiProvidersRepository;let tx:AITransaction;
  beforeEach(()=>{c={execute:jest.fn().mockResolvedValue([[]]),query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    const pool={getConnection:jest.fn().mockResolvedValue(c)};repository=new AiProvidersRepository(pool as never);tx=new AITransaction(pool as never,c);});
  it('scopes metadata and active credentials in SQL without public ciphertext',async()=>{
    await tx.credentials(owner);let [sql,values]=c.execute.mock.calls[0];expect(sql).not.toContain('secret_ciphertext');expect(values).toEqual(['USER','7']);
    await tx.activeCredential(owner,'2');[sql,values]=c.execute.mock.calls[1];expect(values).toEqual(['USER','7','2']);
    expect(sql).toContain('is_active=1 AND revoked_at IS NULL');expect(sql).toContain('FOR UPDATE');
  });
  it('uses NULL-safe SYSTEM scope and scoped mutation predicates',async()=>{
    await tx.credentials({scope:'SYSTEM',userId:null});expect(c.execute.mock.calls[0][1]).toEqual(['SYSTEM',null]);
    await tx.revokeCredential(owner,'9');expect(c.execute.mock.calls[1][0]).toContain('owner_scope=? AND owner_user_id <=> ?');
    expect(c.execute.mock.calls[1][1]).toEqual(['9','USER','7']);
  });
  it('commits successful work and rolls back failed audit/commit',async()=>{
    await repository.transaction(async()=>true);expect(c.commit).toHaveBeenCalled();
    await expect(repository.transaction(async()=>{throw new Error('audit failed');})).rejects.toThrow('audit failed');expect(c.rollback).toHaveBeenCalled();
    c.commit.mockRejectedValue(new Error('commit failed'));
    await expect(repository.transaction(async()=>true)).rejects.toThrow('commit failed');expect(c.release).toHaveBeenCalledTimes(3);
  });
  it('persists user-level profile by PK and never adds per-device configuration',async()=>{
    await tx.saveProfile('7',{...emptyProfile,assistantName:'AIVA'});
    const [sql,values]=c.execute.mock.calls[0];expect(sql).toContain('INSERT INTO ai_profiles(user_id');expect(sql).not.toContain('device_id');expect(values[0]).toBe('7');
  });
});
