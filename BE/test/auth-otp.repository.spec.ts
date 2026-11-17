import { AuthRepository } from '../src/modules/auth/auth.repository';
import { Pool } from 'mysql2/promise';

describe('OTP repository time handling', () => {
  it('compares UTC-encoded expires_at against UTC and keeps single-use guards', async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const repository = new AuthRepository({ execute } as unknown as Pool);
    expect(await repository.consumeEmailOtp('1')).toBe(true);
    const sql = execute.mock.calls[0][0];
    expect(sql).toContain('expires_at > UTC_TIMESTAMP()');
    expect(sql).toContain('consumed_at IS NULL AND invalidated_at IS NULL');
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await repository.consumeEmailOtp('1')).toBe(false);
  });

  it('uses epoch seconds for the resend window and the MySQL-local created_at', async () => {
    const created = new Date('2026-11-17T07:00:00Z');
    const since = new Date('2026-11-17T06:45:00Z');
    const execute = jest.fn().mockResolvedValue([[{ cnt: 1, latest_created_at_seconds: created.getTime() / 1000 }]]);
    const repository = new AuthRepository({ execute } as unknown as Pool);
    const result = await repository.countRecentEmailOtps('1', 'email_verification', since);
    expect(result).toEqual({ count: 1, latestCreatedAt: created });
    expect(execute.mock.calls[0][0]).toContain('UNIX_TIMESTAMP(MAX(created_at))');
    expect(execute.mock.calls[0][0]).toContain('created_at >= FROM_UNIXTIME(?)');
    expect(execute.mock.calls[0][1]).toEqual(['1', 'email_verification', since.getTime() / 1000]);
  });

  it('invalidates previous pending codes before inserting the replacement in one transaction', async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const connection = { execute, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
    const repository = new AuthRepository({ getConnection: async () => connection } as unknown as Pool);
    await repository.createEmailOtp('1', 'email_verification', 'synthetic-test-hash', new Date());
    expect(execute.mock.calls[0][0]).toContain('UPDATE auth_email_otps');
    expect(execute.mock.calls[0][0]).toContain('consumed_at IS NULL AND invalidated_at IS NULL');
    expect(execute.mock.calls[1][0]).toContain('INSERT INTO auth_email_otps');
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('selects the newest pending record for the specified user and purpose', async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    const repository = new AuthRepository({ execute } as unknown as Pool);
    expect(await repository.findLatestPendingEmailOtp('1', 'email_verification')).toBeNull();
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('user_id = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL');
    expect(sql).toContain('ORDER BY id DESC');
    expect(params).toEqual(['1', 'email_verification']);
  });
});
