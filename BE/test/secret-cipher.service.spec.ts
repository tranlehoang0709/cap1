import { ConfigService } from '@nestjs/config';
import { SecretCipherService } from '../src/common/crypto/secret-cipher.service';

describe('SecretCipherService', () => {
  const config = { getOrThrow: () => Buffer.alloc(32, 7).toString('base64url') } as unknown as ConfigService;
  it('encrypts API secrets with authenticated encryption and decrypts only with the same key', () => {
    const cipher = new SecretCipherService(config);
    const encrypted = cipher.encrypt('provider-secret-value');
    expect(encrypted).not.toContain('provider-secret-value');
    expect(encrypted).toMatch(/^v1\./);
    expect(cipher.decrypt(encrypted)).toBe('provider-secret-value');
  });
  it('rejects tampered ciphertext', () => {
    const cipher = new SecretCipherService(config);
    const encrypted = cipher.encrypt('provider-secret-value');
    const parts = encrypted.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
  });
});
