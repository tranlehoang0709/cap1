import { Inject, Injectable } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { PublicUser, UserWithCredential } from '../users/users.types';

@Injectable()
export class AuthRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async findCredentialsByEmail(email: string): Promise<UserWithCredential | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      `SELECT id, email, password_hash, display_name, status, email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE email = ? LIMIT 1`, [email],
    );
    return rows[0] ? this.publicUser(rows[0]) as UserWithCredential : null;
  }

  async findCredentialsById(userId: string): Promise<UserWithCredential | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      `SELECT id, email, password_hash, display_name, status, email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`, [userId],
    );
    return rows[0] ? this.publicUser(rows[0]) as UserWithCredential : null;
  }

  async changePassword(userId: string, passwordHash: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, userId]);
      await connection.execute(
        'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL', [userId],
      );
      await connection.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, occurred_at)
         VALUES (?, 'USER_PASSWORD_CHANGED', 'USER', ?, JSON_OBJECT(), CURRENT_TIMESTAMP)`, [userId, userId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, userId]);
      await connection.execute('UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL', [userId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async createUser(email: string, name: string, passwordHash: string, actorId: string | null = null): Promise<PublicUser> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (email, password_hash, display_name, status, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [email, passwordHash, name],
      );
      const userId = String(insert.insertId);
      const [roles] = await connection.execute<RoleRow[]>('SELECT id FROM roles WHERE code = ? LIMIT 1', ['USER']);
      if (!roles[0]) throw new Error('Required USER role was not seeded');
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roles[0].id]);
      await connection.execute(
        'INSERT INTO privacy_preferences (user_id, save_history, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)', [userId],
      );
      await connection.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, occurred_at)
         VALUES (?, 'USER_REGISTERED', 'USER', ?, JSON_OBJECT('role', 'USER'), CURRENT_TIMESTAMP)`, [actorId, userId],
      );
      await connection.commit();
      const [users] = await connection.execute<UserRow[]>(
        `SELECT id, email, password_hash, display_name, status, email_verified_at, last_login_at, created_at, updated_at
         FROM users WHERE id = ?`, [userId],
      );
      return this.publicUser(users[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
  }

  async verifyEmail(userId: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId],
    );
    return result.affectedRows === 1;
  }

  async createRefreshSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.execute(
      'INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [userId, tokenHash, expiresAt],
    );
  }

  async rotateRefreshSession(oldHash: string, newHash: string, expiresAt: Date): Promise<boolean> {
    // mysql2 serializes expires_at in UTC; the MySQL session may use UTC+7.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE auth_sessions SET refresh_token_hash = ?, expires_at = ?
       WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
      [newHash, expiresAt, oldHash],
    );
    return result.affectedRows === 1;
  }

  async revokeRefreshSession(tokenHash: string): Promise<void> {
    await this.pool.execute(
      'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE refresh_token_hash = ? AND revoked_at IS NULL',
      [tokenHash],
    );
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.pool.execute(
      'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL', [userId],
    );
  }

  async countRecentEmailOtps(
    userId: string,
    purpose: OtpPurpose,
    since: Date,
  ): Promise<{ count: number; latestCreatedAt: Date | null }> {
    const [rows] = await this.pool.execute<OtpCountRow[]>(
      // created_at is generated in the MySQL session timezone. Return an epoch,
      // rather than decoding that local DATETIME with the pool's timezone: 'Z'.
      `SELECT COUNT(*) AS cnt, UNIX_TIMESTAMP(MAX(created_at)) AS latest_created_at_seconds
       FROM auth_email_otps
       WHERE user_id = ? AND purpose = ? AND created_at >= FROM_UNIXTIME(?)`,
      [userId, purpose, since.getTime() / 1000],
    );
    const row = rows[0];
    return {
      count: Number(row?.cnt ?? 0),
      latestCreatedAt: row?.latest_created_at_seconds != null
        ? new Date(Number(row.latest_created_at_seconds) * 1000) : null,
    };
  }

  async createEmailOtp(
    userId: string,
    purpose: OtpPurpose,
    codeHash: string,
    expiresAt: Date,
    maxAttempts = 5,
  ): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE auth_email_otps
         SET invalidated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [userId, purpose],
      );
      await connection.execute(
        `INSERT INTO auth_email_otps (user_id, purpose, code_hash, attempts, max_attempts, expires_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, purpose, codeHash, maxAttempts, expiresAt],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findLatestPendingEmailOtp(userId: string, purpose: OtpPurpose): Promise<EmailOtpRecord | null> {
    const [rows] = await this.pool.execute<EmailOtpRow[]>(
      `SELECT id, user_id, purpose, code_hash, attempts, max_attempts, expires_at, consumed_at, invalidated_at, created_at
       FROM auth_email_otps
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [userId, purpose],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      purpose: row.purpose,
      code_hash: row.code_hash,
      attempts: Number(row.attempts),
      max_attempts: Number(row.max_attempts),
      expires_at: new Date(row.expires_at),
      consumed_at: row.consumed_at ? new Date(row.consumed_at) : null,
      invalidated_at: row.invalidated_at ? new Date(row.invalidated_at) : null,
      created_at: new Date(row.created_at),
    };
  }

  async incrementEmailOtpAttempt(otpId: string): Promise<{ attempts: number; max_attempts: number }> {
    // MySQL evaluates invalidated_at after incrementing attempts.
    await this.pool.execute(
      `UPDATE auth_email_otps
       SET attempts = attempts + 1,
           invalidated_at = CASE WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP ELSE invalidated_at END
       WHERE id = ? AND consumed_at IS NULL AND invalidated_at IS NULL
         AND attempts < max_attempts AND expires_at > UTC_TIMESTAMP()`,
      [otpId],
    );
    const [rows] = await this.pool.execute<OtpAttemptRow[]>(
      'SELECT attempts, max_attempts FROM auth_email_otps WHERE id = ? LIMIT 1',
      [otpId],
    );
    return {
      attempts: Number(rows[0]?.attempts ?? 0),
      max_attempts: Number(rows[0]?.max_attempts ?? 5),
    };
  }

  async consumeEmailOtp(otpId: string): Promise<boolean> {
    // expires_at is a Node Date serialized as UTC by mysql2 (timezone: 'Z').
    // CURRENT_TIMESTAMP follows the server session timezone and may be UTC+7.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE auth_email_otps
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND consumed_at IS NULL AND invalidated_at IS NULL
         AND attempts < max_attempts AND expires_at > UTC_TIMESTAMP()`,
      [otpId],
    );
    return result.affectedRows === 1;
  }

  /** Metadata only: never return an OTP/hash in diagnostic logs. */
  async emailOtpOutcome(userId: string, purpose: OtpPurpose, otpId?: string): Promise<string> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT CASE
         WHEN consumed_at IS NOT NULL THEN 'already_used'
         WHEN attempts >= max_attempts THEN 'attempt_limit'
         WHEN invalidated_at IS NOT NULL THEN 'invalidated'
         WHEN expires_at <= UTC_TIMESTAMP() THEN 'expired'
         ELSE 'pending'
       END AS outcome
       FROM auth_email_otps WHERE user_id = ? AND purpose = ?${otpId ? ' AND id = ?' : ''}
       ORDER BY id DESC LIMIT 1`,
      otpId ? [userId, purpose, otpId] : [userId, purpose],
    );
    return rows[0]?.outcome ?? 'not_found';
  }

  async invalidatePendingEmailOtps(userId: string, purpose: OtpPurpose): Promise<void> {
    await this.pool.execute(
      `UPDATE auth_email_otps
       SET invalidated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [userId, purpose],
    );
  }

  private publicUser(row: UserRow): PublicUser & { password_hash: string } {
    return {
      id: String(row.id), email: row.email, display_name: row.display_name, status: row.status,
      email_verified_at: row.email_verified_at, last_login_at: row.last_login_at,
      created_at: row.created_at, updated_at: row.updated_at, password_hash: row.password_hash,
    };
  }
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: 'active' | 'suspended' | 'disabled';
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RoleRow extends RowDataPacket { id: number }

export type OtpPurpose = 'email_verification' | 'password_reset';

export interface EmailOtpRecord {
  id: string;
  user_id: string;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  invalidated_at: Date | null;
  created_at: Date;
}

interface OtpCountRow extends RowDataPacket {
  cnt: number;
  latest_created_at_seconds: number | string | null;
}

interface EmailOtpRow extends RowDataPacket {
  id: string | number;
  user_id: string | number;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  invalidated_at: Date | string | null;
  created_at: Date | string;
}

interface OtpAttemptRow extends RowDataPacket {
  attempts: number;
  max_attempts: number;
}
