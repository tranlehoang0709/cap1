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
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE auth_sessions SET refresh_token_hash = ?, expires_at = ?
       WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
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
