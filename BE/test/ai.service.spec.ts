import { AiRepository } from '../src/modules/ai/ai.repository';
import { AiService } from '../src/modules/ai/ai.service';
import { SecretCipherService } from '../src/common/crypto/secret-cipher.service';

describe('AiService', () => {
  const repo = { providerEnabled: jest.fn(), createCredential: jest.fn(), quota: jest.fn(), useCount: jest.fn(), usageSince: jest.fn(), createConversation: jest.fn() };
  const cipher = { encrypt: jest.fn((value: string) => `encrypted:${value}`) };
  const service = new AiService(repo as unknown as AiRepository, cipher as unknown as SecretCipherService);
  beforeEach(() => jest.clearAllMocks());
  it('encrypts a personal API key and returns only its final-four hint', async () => {
    repo.providerEnabled.mockResolvedValue({ id: '1', is_enabled: true }); repo.createCredential.mockResolvedValue('8');
    await expect(service.addKey('2', '1', 'Personal key', 'secret-1234')).resolves.toEqual({ id: '8', label: 'Personal key', secret_hint: '****1234' });
    expect(cipher.encrypt).toHaveBeenCalledWith('secret-1234');
    expect(repo.createCredential).toHaveBeenCalledWith('1', '2', 'Personal key', 'encrypted:secret-1234', '1234');
  });
  it('enforces request-per-minute quota before calling the chat adapter', async () => {
    repo.providerEnabled.mockResolvedValue({ id: '1', name: 'Local AI', is_enabled: true }); repo.quota.mockResolvedValue({ requests_per_minute: 2, requests_per_day: null, tokens_per_month: null }); repo.usageSince.mockResolvedValue({ requests: 2, tokens: 0 });
    await expect(service.chat('2', 'hello', '1')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(repo.createConversation).not.toHaveBeenCalled();
  });
});
