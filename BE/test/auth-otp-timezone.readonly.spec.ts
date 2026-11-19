import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { createConnection, Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { AuthRepository } from '../src/modules/auth/auth.repository';

// Explicit opt-in. All real MySQL statements below are SELECTs; no test users,
// OTPs, tables, emails, migrations or other persistent data are created.
const readOnlyMysql = process.env.OTP_READONLY_MYSQL_CHECKS === 'true' ? describe : describe.skip;
readOnlyMysql('OTP regression against real MySQL (SELECT only)', () => {
  let connection: Connection;
  beforeAll(async () => {
    const env = parse(readFileSync(resolve(__dirname, '../.env')));
    connection = await createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
      user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, timezone: 'Z' });
  });
  afterAll(async () => { if (connection) await connection.end(); });

  it.each([
    ['new', 300, false, false, true],
    ['expired', -1, false, false, false],
    ['used', 300, true, false, false],
    ['invalidated', 300, false, true, false],
  ])('evaluates the production consume predicate for a %s OTP', async (_name, seconds, used, invalidated, expected) => {
    const repository = new AuthRepository({
      execute: async (sql: string, params: string[]) => {
        // Execute the exact production WHERE predicate on a derived row only.
        const predicate = sql.slice(sql.indexOf('WHERE ') + 6);
        const [rows] = await connection.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS eligible FROM (SELECT 1 AS id, ? AS expires_at,
            ? AS consumed_at, ? AS invalidated_at) AS auth_email_otps WHERE ${predicate}`,
          [new Date(Date.now() + Number(seconds) * 1000), used ? new Date() : null,
            invalidated ? new Date() : null, ...params],
        );
        return [{ affectedRows: Number(rows[0].eligible) }];
      },
    } as unknown as Pool);
    expect(await repository.consumeEmailOtp('1')).toBe(expected);
  });

  it('decodes UTC expiry correctly regardless of the Node local timezone', async () => {
    const expires = new Date(Math.floor(Date.now() / 1000) * 1000 + 300_000);
    const [rows] = await connection.execute<RowDataPacket[]>('SELECT CAST(? AS DATETIME) AS expires_at', [expires]);
    expect(rows[0].expires_at.getTime()).toBe(expires.getTime());
  });

  it.each([
    ['five minutes remaining', 300, false, 'old', true],
    ['one hour remaining', 3600, false, 'old', true],
    ['eight hours remaining', 28800, false, 'old', true],
    ['expired', -1, false, 'old', false],
    ['revoked', 3600, true, 'old', false],
    ['rotated token cannot be reused', 3600, false, 'replacement', false],
  ])('evaluates the production refresh predicate: %s (real MySQL SELECT only)', async (_label, seconds, revoked, storedHash, expected) => {
    const expiresAt = new Date(Date.now() + Number(seconds) * 1000);
    const repository = new AuthRepository({
      execute: async (sql: string, params: [string, Date, string]) => {
        // Reuse the exact WHERE emitted by rotateRefreshSession. Do not execute
        // its UPDATE: only evaluate eligibility on a synthetic derived row.
        const predicate = sql.slice(sql.indexOf('WHERE ') + 6);
        const [rows] = await connection.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS eligible FROM (SELECT ? AS refresh_token_hash,
            CAST(? AS DATETIME) AS expires_at, ? AS revoked_at) AS auth_sessions WHERE ${predicate}`,
          [storedHash, expiresAt, revoked ? new Date() : null, params[2]],
        );
        return [{ affectedRows: Number(rows[0].eligible) }];
      },
    } as unknown as Pool);
    expect(await repository.rotateRefreshSession('old', 'replacement', new Date(Date.now() + 86400_000))).toBe(expected);
  });

  it('confirms the MySQL session clock and the UTC future-expiry comparison independently', async () => {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), CURRENT_TIMESTAMP) AS offset_seconds,
        (? > UTC_TIMESTAMP()) AS utc_eligible, (? > CURRENT_TIMESTAMP) AS local_eligible`,
      [new Date(Date.now() + 3600_000), new Date(Date.now() + 3600_000)],
    );
    expect(Number(rows[0].utc_eligible)).toBe(1);
    // On the actual UTC+7 server the old condition rejects a valid session.
    if (Number(rows[0].offset_seconds) >= 7200) expect(Number(rows[0].local_eligible)).toBe(0);
  });

  it('reads MySQL-local creation time as a UTC epoch without a seven-hour resend cooldown', async () => {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP) AS created_epoch,
        CURRENT_TIMESTAMP >= FROM_UNIXTIME(?) AS in_resend_window`,
      [(Date.now() - 15 * 60_000) / 1000],
    );
    expect(Math.abs(Date.now() - Number(rows[0].created_epoch) * 1000)).toBeLessThan(5000);
    expect(Number(rows[0].in_resend_window)).toBe(1);
  });
});
