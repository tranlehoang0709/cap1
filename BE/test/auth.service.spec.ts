import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthRepository, EmailOtpRecord } from '../src/modules/auth/auth.repository';
import { SmtpMailerService } from '../src/modules/auth/smtp-mailer.service';
import { UsersService } from '../src/modules/users/users.service';
import { UserWithCredential } from '../src/modules/users/users.types';

describe('AuthService', () => {
  const user: UserWithCredential = {
    id: '42',
    email: 'person@example.test',
    display_name: 'Person',
    password_hash: '',
    status: 'active',
    email_verified_at: new Date(),
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  let repository: jest.Mocked<
    Pick<
      AuthRepository,
      | 'findCredentialsByEmail'
      | 'createUser'
      | 'updateLastLogin'
      | 'createRefreshSession'
      | 'rotateRefreshSession'
      | 'verifyEmail'
      | 'resetPassword'
      | 'countRecentEmailOtps'
      | 'createEmailOtp'
      | 'findLatestPendingEmailOtp'
      | 'incrementEmailOtpAttempt'
      | 'consumeEmailOtp'
      | 'invalidatePendingEmailOtps'
      | 'emailOtpOutcome'
    >
  >;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync' | 'verifyAsync'>>;
  let users: jest.Mocked<Pick<UsersService, 'canLogin'>>;
  let mailer: jest.Mocked<Pick<SmtpMailerService, 'isConfigured' | 'sendVerificationOtp' | 'sendPasswordResetOtp'>>;
  let config: ConfigService;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findCredentialsByEmail: jest.fn(),
      createUser: jest.fn(),
      updateLastLogin: jest.fn(),
      createRefreshSession: jest.fn(),
      rotateRefreshSession: jest.fn(),
      verifyEmail: jest.fn().mockResolvedValue(true),
      resetPassword: jest.fn().mockResolvedValue(undefined),
      countRecentEmailOtps: jest.fn().mockResolvedValue({ count: 0, latestCreatedAt: null }),
      createEmailOtp: jest.fn().mockResolvedValue(undefined),
      findLatestPendingEmailOtp: jest.fn(),
      incrementEmailOtpAttempt: jest.fn().mockResolvedValue({ attempts: 1, max_attempts: 5 }),
      consumeEmailOtp: jest.fn().mockResolvedValue(true),
      invalidatePendingEmailOtps: jest.fn().mockResolvedValue(undefined),
      emailOtpOutcome: jest.fn().mockResolvedValue('not_found'),
    };
    jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
    users = { canLogin: jest.fn().mockResolvedValue({ allowed: true, reason: null }) };
    mailer = {
      isConfigured: jest.fn().mockReturnValue(false),
      sendVerificationOtp: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      getOrThrow: (key: string) =>
        ({
          'auth.accessTokenSecret': 'a'.repeat(40),
          'auth.refreshTokenSecret': 'b'.repeat(40),
          'auth.accessTokenTtlSeconds': 900,
          'auth.refreshTokenTtlSeconds': 3600,
        }[key]),
    } as unknown as ConfigService;
    service = new AuthService(
      repository as unknown as AuthRepository,
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      config,
      mailer as unknown as SmtpMailerService,
    );
  });

  // In-memory unit fixture only: no account creation, SMTP or live DB writes.
  async function issueVerification() {
    const pendingUser = { ...user, email_verified_at: null as Date | null };
    const records: EmailOtpRecord[] = [];
    mailer.isConfigured.mockReturnValue(true);
    repository.createUser.mockResolvedValue(pendingUser);
    repository.findCredentialsByEmail.mockImplementation(async () => pendingUser);
    repository.createEmailOtp.mockImplementation(async (userId, purpose, hash, expiresAt, maxAttempts = 5) => {
      for (const record of records) {
        if (!record.consumed_at && !record.invalidated_at) record.invalidated_at = new Date();
      }
      records.push({ id: String(records.length + 1), user_id: userId, purpose, code_hash: hash,
        expires_at: expiresAt, attempts: 0, max_attempts: maxAttempts, created_at: new Date(),
        consumed_at: null, invalidated_at: null });
    });
    repository.findLatestPendingEmailOtp.mockImplementation(async () =>
      [...records].reverse().find(r => !r.consumed_at && !r.invalidated_at) ?? null);
    repository.consumeEmailOtp.mockImplementation(async id => {
      const record = records.find(r => r.id === id);
      if (!record || record.consumed_at || record.invalidated_at || record.expires_at.getTime() <= Date.now()) return false;
      record.consumed_at = new Date();
      return true;
    });
    repository.verifyEmail.mockImplementation(async () => { pendingUser.email_verified_at = new Date(); return true; });
    repository.invalidatePendingEmailOtps.mockImplementation(async () => {
      for (const record of records) if (!record.consumed_at) record.invalidated_at = new Date();
    });
    await service.register(' PERSON@Example.Test ', 'Person', 'a-secure-password');
    return { records, pendingUser, code: mailer.sendVerificationOtp.mock.calls[0][1] };
  }

  it('accepts the generated OTP immediately, preserves the five-minute TTL, normalizes email and updates verified_at', async () => {
    const { records, code, pendingUser } = await issueVerification();
    expect(records[0].expires_at.getTime() - records[0].created_at.getTime()).toBeGreaterThanOrEqual(299_000);
    expect(records[0].expires_at.getTime() - records[0].created_at.getTime()).toBeLessThanOrEqual(300_000);
    await expect(service.verifyEmail(' PERSON@example.test ', ` ${code} `)).resolves.toEqual({ success: true });
    expect(pendingUser.email_verified_at).toBeInstanceOf(Date);
    expect(records[0].consumed_at).toBeInstanceOf(Date);
  });

  it('rejects a wrong code without consuming it or verifying the account, and logs no OTP or hash', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { code, records, pendingUser } = await issueVerification();
      const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
      await expect(service.verifyEmail(user.email, wrong)).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
      expect(repository.incrementEmailOtpAttempt).toHaveBeenCalledWith(records[0].id);
      expect(pendingUser.email_verified_at).toBeNull();
      expect(records[0].consumed_at).toBeNull();
      const messages = log.mock.calls.map(c => String(c[0])).join('\n');
      expect(messages.includes('outcome=wrong_code')).toBe(true);
      expect(messages.includes(code)).toBe(false);
      expect(messages.includes(records[0].code_hash)).toBe(false);
    } finally { log.mockRestore(); }
  });

  it('rejects at the exact expiry boundary without consuming or verifying', async () => {
    const { records, code, pendingUser } = await issueVerification();
    const now = jest.spyOn(Date, 'now').mockReturnValue(records[0].expires_at.getTime());
    try {
      await expect(service.verifyEmail(user.email, code)).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
      expect(records[0].invalidated_at).toBeInstanceOf(Date);
      expect(records[0].consumed_at).toBeNull();
      expect(pendingUser.email_verified_at).toBeNull();
    } finally { now.mockRestore(); }
  });

  it('resend invalidates the previous record and only the newly generated OTP verifies', async () => {
    const { records, code } = await issueVerification();
    await service.resendVerification(user.email);
    expect(records[0].invalidated_at).toBeInstanceOf(Date);
    expect(records[1].invalidated_at).toBeNull();
    const replacement = mailer.sendVerificationOtp.mock.calls[1][1];
    // Random OTPs may coincidentally be equal; otherwise the prior value must fail.
    if (replacement !== code) await expect(service.verifyEmail(user.email, code)).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
    await expect(service.verifyEmail(user.email, replacement)).resolves.toEqual({ success: true });
    expect(repository.consumeEmailOtp).toHaveBeenCalledWith(records[1].id);
  });

  it('consumes once; repeated verification is idempotent and never consumes or updates again', async () => {
    const { code } = await issueVerification();
    await service.verifyEmail(user.email, code);
    await expect(service.verifyEmail(user.email, code)).resolves.toEqual({ success: true, already_verified: true });
    expect(repository.consumeEmailOtp).toHaveBeenCalledTimes(1);
    expect(repository.verifyEmail).toHaveBeenCalledTimes(1);
  });

  it.each(['expired', 'already_used', 'invalidated'])('logs the actual %s state when conditional consumption loses a race', async outcome => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { code } = await issueVerification();
      repository.consumeEmailOtp.mockResolvedValueOnce(false);
      repository.emailOtpOutcome.mockResolvedValueOnce(outcome);
      await expect(service.verifyEmail(user.email, code)).rejects.toMatchObject({ status: 400 });
      expect(log.mock.calls.some(c => String(c[0]).includes(`outcome=${outcome}`))).toBe(true);
      expect(repository.verifyEmail).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('logs internal processing failure without exposing driver details', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      repository.findCredentialsByEmail.mockRejectedValueOnce(new Error('private-driver-details'));
      await expect(service.verifyEmail(user.email, '123456')).rejects.toThrow();
      expect(log).toHaveBeenCalledWith('email_otp outcome=internal_error');
      expect(log.mock.calls.flat().join(' ').includes('private-driver-details')).toBe(false);
    } finally { log.mockRestore(); }
  });

  it('normalizes registration email, stores only a bcrypt hash, and returns a safe account DTO', async () => {
    repository.createUser.mockImplementation(async (email, name, hash) => ({
      ...user,
      email,
      display_name: name,
      password_hash: hash,
      email_verified_at: null,
    }));
    const result = await service.register(' Person@Example.Test ', ' Person ', 'a-secure-password');
    expect(repository.createUser).toHaveBeenCalledWith('person@example.test', 'Person', expect.stringMatching(/^\$2[aby]\$/), null);
    expect(result).toEqual({
      id: '42',
      email: 'person@example.test',
      display_name: 'Person',
      verification_sent: false,
    });
    expect(result).not.toHaveProperty('password_hash');
    expect(result).not.toHaveProperty('verification_token');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('sends a 6-digit OTP via SMTP on registration when SMTP is configured and stores only its HMAC hash', async () => {
    mailer.isConfigured.mockReturnValue(true);
    repository.createUser.mockImplementation(async (email, name, hash) => ({
      ...user,
      email,
      display_name: name,
      password_hash: hash,
      email_verified_at: null,
    }));
    const result = await service.register('person@example.test', 'Person', 'a-secure-password');
    expect(result.verification_sent).toBe(true);
    expect(mailer.sendVerificationOtp).toHaveBeenCalledWith('person@example.test', expect.stringMatching(/^\d{6}$/));
    const sentOtp = mailer.sendVerificationOtp.mock.calls[0][1];
    const storedHash = repository.createEmailOtp.mock.calls[0][2];
    expect(storedHash).not.toBe(sentOtp);
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a valid 6-digit OTP once and marks email verified in MySQL', async () => {
    mailer.isConfigured.mockReturnValue(true);
    repository.createUser.mockResolvedValue({ ...user, email_verified_at: null });
    await service.register('person@example.test', 'Person', 'a-secure-password');
    const sentOtp = mailer.sendVerificationOtp.mock.calls[0][1];
    const storedHash = repository.createEmailOtp.mock.calls[0][2];

    repository.findCredentialsByEmail.mockResolvedValue({ ...user, email_verified_at: null });
    repository.findLatestPendingEmailOtp.mockResolvedValue({
      id: '7',
      user_id: '42',
      purpose: 'email_verification',
      code_hash: storedHash,
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      invalidated_at: null,
      created_at: new Date(),
    } satisfies EmailOtpRecord);

    const verified = await service.verifyEmail('PERSON@example.test', sentOtp);
    expect(verified).toEqual({ success: true });
    expect(repository.consumeEmailOtp).toHaveBeenCalledWith('7');
    expect(repository.verifyEmail).toHaveBeenCalledWith('42');
  });

  it('rejects wrong or expired OTPs and tracks attempts', async () => {
    repository.findCredentialsByEmail.mockResolvedValue({ ...user, email_verified_at: null });
    repository.findLatestPendingEmailOtp.mockResolvedValue({
      id: '7',
      user_id: '42',
      purpose: 'email_verification',
      code_hash: '0'.repeat(64),
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      invalidated_at: null,
      created_at: new Date(),
    });
    await expect(service.verifyEmail(user.email, '123456')).rejects.toMatchObject({ status: 400 });
    expect(repository.incrementEmailOtpAttempt).toHaveBeenCalledWith('7');

    repository.findLatestPendingEmailOtp.mockResolvedValue({
      id: '8',
      user_id: '42',
      purpose: 'email_verification',
      code_hash: '0'.repeat(64),
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() - 1_000),
      consumed_at: null,
      invalidated_at: null,
      created_at: new Date(),
    });
    await expect(service.verifyEmail(user.email, '123456')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'OTP_EXPIRED' }),
    });
    expect(repository.invalidatePendingEmailOtps).toHaveBeenCalledWith('42', 'email_verification');
  });

  it('enforces resend cooldown and returns consistent response on forgotPassword without leaking existence', async () => {
    mailer.isConfigured.mockReturnValue(true);
    repository.findCredentialsByEmail.mockResolvedValueOnce({ ...user, email_verified_at: null });
    repository.countRecentEmailOtps.mockResolvedValueOnce({ count: 1, latestCreatedAt: new Date() });
    await expect(service.resendVerification(user.email)).rejects.toMatchObject({ status: 429 });

    repository.findCredentialsByEmail.mockResolvedValueOnce(null);
    const forgotMissing = await service.forgotPassword('nobody@example.test');
    expect(forgotMissing.success).toBe(true);
    expect(mailer.sendPasswordResetOtp).not.toHaveBeenCalled();

    repository.findCredentialsByEmail.mockResolvedValueOnce({ ...user });
    const forgotExisting = await service.forgotPassword(user.email);
    expect(forgotExisting.message).toBe(forgotMissing.message);
    expect(mailer.sendPasswordResetOtp).toHaveBeenCalledWith(user.email, expect.stringMatching(/^\d{6}$/));
  });

  it('resets password with a valid 6-digit OTP and returns consistent error otherwise', async () => {
    mailer.isConfigured.mockReturnValue(true);
    repository.findCredentialsByEmail.mockResolvedValue({ ...user });
    await service.forgotPassword(user.email);
    const sentOtp = mailer.sendPasswordResetOtp.mock.calls[0][1];
    const storedHash = repository.createEmailOtp.mock.calls[0][2];

    repository.findLatestPendingEmailOtp.mockResolvedValue({
      id: '9',
      user_id: '42',
      purpose: 'password_reset',
      code_hash: storedHash,
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      invalidated_at: null,
      created_at: new Date(),
    });

    const reset = await service.resetPassword(user.email, sentOtp, 'new-secure-password');
    expect(reset).toEqual({ success: true });
    expect(repository.consumeEmailOtp).toHaveBeenCalledWith('9');
    expect(repository.resetPassword).toHaveBeenCalledWith('42', expect.stringMatching(/^\$2[aby]\$/));

    repository.findCredentialsByEmail.mockResolvedValueOnce(null);
    await expect(service.resetPassword('nobody@example.test', '000000', 'new-secure-password')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'OTP_INVALID_OR_EXPIRED' }),
    });
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

  it('distinguishes EMAIL_NOT_VERIFIED, ACCOUNT_SUSPENDED, and ACCOUNT_DISABLED only after password verification', async () => {
    const passwordHash = await import('bcrypt').then(({ hash }) => hash('correct-password', 4));
    repository.findCredentialsByEmail.mockResolvedValue({ ...user, password_hash: passwordHash });

    await expect(service.login('person@example.test', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
    });
    expect(users.canLogin).not.toHaveBeenCalled();

    users.canLogin.mockResolvedValueOnce({ allowed: false, reason: 'EMAIL_NOT_VERIFIED' });
    await expect(service.login('person@example.test', 'correct-password')).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    });

    users.canLogin.mockResolvedValueOnce({ allowed: false, reason: 'ACCOUNT_SUSPENDED' });
    await expect(service.login('person@example.test', 'correct-password')).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' }),
    });

    users.canLogin.mockResolvedValueOnce({ allowed: false, reason: 'ACCOUNT_DISABLED' });
    await expect(service.login('person@example.test', 'correct-password')).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'ACCOUNT_DISABLED' }),
    });

    expect(repository.createRefreshSession).not.toHaveBeenCalled();
  });

  it('blocks public recovery and verification issuance when SMTP is not configured', async () => {
    await expect(service.forgotPassword(user.email)).rejects.toMatchObject({ status: 503 });
    await expect(service.resendVerification(user.email)).rejects.toMatchObject({ status: 503 });
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(repository.findCredentialsByEmail).not.toHaveBeenCalled();
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
