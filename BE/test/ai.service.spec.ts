import { AiRepository } from '../src/modules/ai/ai.repository';
import { AiService } from '../src/modules/ai/ai.service';
import { SecretCipherService } from '../src/common/crypto/secret-cipher.service';

describe('AiService', () => {
  const repo = { providerEnabled: jest.fn(), provider:jest.fn(), createCredential: jest.fn(),replaceCredential:jest.fn(),compatibleModel:jest.fn(),
    allModels:jest.fn(),createModel:jest.fn(),updateModel:jest.fn(),upsertProfile:jest.fn() };
  const cipher = { encrypt: jest.fn((value: string) => `encrypted:${value}`) };
  const service = new AiService(repo as unknown as AiRepository, cipher as unknown as SecretCipherService);
  beforeEach(() => jest.clearAllMocks());
  it('encrypts a personal API key and returns redacted metadata only', async () => {
    repo.providerEnabled.mockResolvedValue({ id: '1', code:'GEMINI',is_enabled: true }); repo.createCredential.mockResolvedValue('8');
    await expect(service.addKey('2', '1', 'Personal key', 'secret-1234')).resolves.toEqual({ id: '8', label: 'Personal key',provider_id:'1', secret_hint: 'configured' });
    expect(cipher.encrypt).toHaveBeenCalledWith('secret-1234');
    expect(repo.createCredential).toHaveBeenCalledWith('1', '2', 'Personal key', 'encrypted:secret-1234', '1234');
  });
  it('replaces only an active key owned by the current user',async()=>{
    repo.replaceCredential.mockResolvedValue({id:'8',provider_id:'1',label:'new',is_active:true});
    await expect(service.replaceKey('2','8','new','replacement-secret')).resolves.toEqual({id:'8',provider_id:'1',label:'new',is_active:true,secret_hint:'configured'});
    expect(repo.replaceCredential).toHaveBeenCalledWith('8','2','new','encrypted:replacement-secret','cret');
    repo.replaceCredential.mockResolvedValue(null);await expect(service.replaceKey('3','8','new','replacement-secret')).rejects.toMatchObject({code:'API_KEY_NOT_FOUND'});
  });
  it('binds an LLM model to the selected provider',async()=>{
    repo.providerEnabled.mockResolvedValue({id:'1',code:'GEMINI',is_enabled:true});repo.compatibleModel.mockResolvedValue(false);
    await expect(service.updateProfile('2',{assistant_name:null,system_prompt:null,language_code:'vi',voice_code:null,preferred_provider_id:'1',preferred_llm_model_id:'9'})).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});
    expect(repo.upsertProfile).not.toHaveBeenCalled();
  });
  it('allows Admin model creation only for supported providers',async()=>{
    repo.provider.mockResolvedValue({id:'1',code:'GEMINI'});repo.createModel.mockResolvedValue({id:'9'});
    await expect(service.createModel('1','gemini-test','llm',true)).resolves.toEqual({id:'9'});
    repo.provider.mockResolvedValue({id:'4',code:'UNKNOWN'});await expect(service.createModel('4','bad','llm',true)).rejects.toMatchObject({code:'PROVIDER_NOT_FOUND'});
  });
  it('fails closed instead of generating mock chat replies or estimated usage', async () => {
    await expect(service.chat('2', 'hello', '1')).rejects.toMatchObject({ code: 'AI_PIPELINE_UNAVAILABLE' });
  });
});
