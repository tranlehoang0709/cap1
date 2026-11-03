import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { UsersService } from '../src/modules/users/users.service';
import { UserWithCredential } from '../src/modules/users/users.types';

describe('AuthService', () => {
  const user: UserWithCredential = {
    id: '42', email: 'person@example.test', display_name: 'Person', password_hash: '', status: 'active',
    email_verified_at: new Date(), last_login_at: null, created_at: new Date(), updated_at: new Date(),
  };
  let repository: jest.Mocked<Pick<AuthRepository,
    'findCredentialsByEmail' | 'createUser' | 'updateLastLogin' | 'createRefreshSession' | 'rotateRefreshSession'>>;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync' | 'verifyAsync'>>;
  let users: jest.Mocked<Pick<UsersService, 'canLogin'>>;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findCredentialsByEmail: jest.fn(), createUser: jest.fn(), updateLastLogin: jest.fn(),
      createRefreshSession: jest.fn(), rotateRefreshSession: jest.fn(),
    };
    jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
    users = { canLogin: jest.fn().mockResolvedValue({ allowed: true, reason: null }) };
    const config = { getOrThrow: (key: string) => ({
      'auth.accessTokenSecret': 'a'.repeat(40), 'auth.refreshTokenSecret': 'b'.repeat(40),
      'auth.accessTokenTtlSeconds': 900, 'auth.refreshTokenTtlSeconds': 3600,
    }[key]) } as unknown as ConfigService;
    service = new AuthService(repository as unknown as AuthRepository, users as unknown as UsersService, jwt as unknown as JwtService, config);
  });

  it('normalizes registration email, stores only a bcrypt hash, and returns a safe account DTO', async () => {
    repository.createUser.mockImplementation(async (email, name, hash) => ({ ...user, email, display_name: name, password_hash: hash }));
    const result = await service.register(' Person@Example.Test ', ' Person ', 'a-secure-password');
    expect(repository.createUser).toHaveBeenCalledWith('person@example.test', 'Person', expect.stringMatching(/^\$2[aby]\$/), null);
    expect(result).toEqual({ id: '42', email: 'person@example.test', display_name: 'Person' });
    expect(result).not.toHaveProperty('password_hash');
  });

  it('issues access/refresh tokens and persists only the refresh token hash on login', async () => {
    const passwordHash = await import('bcrypt').then(({ hash }) => hash('correct-password', 4));
    repository.findCredentialsByEmail.mockResolvedValue({ ...user, password_hash: passwordHash });
    jwt.signAsync.mockResolvedValueOnce('access.jwt').mockResolvedValueOnce('refresh.jwt');
    const result = await service.login('PERSON@example.test', 'correct-password');
    expect(result).toEqual({ access_token: 'access.jwt', refresh_token: 'refresh.jwt', token_type: 'Bearer', expires_in: 900 });
    expect(repository.updateLastLogin).toHaveBeenCalledWith('42');
    expect(repository.createRefreshSession).toHaveBeenCalledWith('42', createHash('sha256').update('refresh.jwt').digest('hex'), expect.any(Date));
  });

  it('rejects invalid passwords without creating a session', async () => {
    const passwordHash = await import('bcrypt').then(({ hash }) => hash('correct-password', 4));
    repository.findCredentialsByEmail.mockResolvedValue({ ...user, password_hash: passwordHash });
    await expect(service.login('person@example.test', 'wrong-password')).rejects.toMatchObject({ status: 401 });
    expect(repository.createRefreshSession).not.toHaveBeenCalled();
  });

  it('rotates a refresh session with a new hash and returns a fresh access token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: '42', typ: 'refresh', jti: 'old-id' });
    jwt.signAsync.mockResolvedValueOnce('next-refresh.jwt').mockResolvedValueOnce('next-access.jwt');
    repository.rotateRefreshSession.mockResolvedValue(true);
    const result = await service.refresh('old-refresh.jwt');
    expect(repository.rotateRefreshSession).toHaveBeenCalledWith(
      createHash('sha256').update('old-refresh.jwt').digest('hex'),
      createHash('sha256').update('next-refresh.jwt').digest('hex'),
      expect.any(Date),
    );
    expect(result).toMatchObject({ access_token: 'next-access.jwt', refresh_token: 'next-refresh.jwt', expires_in: 900 });
  });
});
