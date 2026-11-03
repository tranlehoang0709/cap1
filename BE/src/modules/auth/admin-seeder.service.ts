import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import * as bcrypt from 'bcrypt';
import { MYSQL_POOL } from '../../database/database.constants';

@Injectable()
export class AdminSeeder implements OnApplicationBootstrap {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool, private readonly config: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.getOrThrow<string>('auth.adminEmail').trim().toLowerCase();
    const password = this.config.getOrThrow<string>('auth.adminPassword');
    const displayName = this.config.getOrThrow<string>('auth.adminDisplayName').trim();
    const [existingRows] = await this.pool.execute<ExistingAdminRow[]>(
      `SELECT u.id, u.status, u.email_verified_at, COUNT(r.code) AS role_count, MAX(r.code) AS role
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.email = ? GROUP BY u.id, u.status, u.email_verified_at LIMIT 1`, [email],
    );
    const existing = existingRows[0];
    if (existing) {
      if (Number(existing.role_count) !== 1 || existing.role !== 'ADMIN' || existing.status !== 'active' || !existing.email_verified_at) {
        throw new Error('ADMIN_EMAIL already belongs to an account that is not an active, verified Admin');
      }
      return; // Never overwrite the password of an existing account on restart.
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [roles] = await connection.execute<RoleRow[]>('SELECT id FROM roles WHERE code = ? LIMIT 1 FOR UPDATE', ['ADMIN']);
      if (!roles[0]) throw new Error('ADMIN role is missing; run the baseline migration first');
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (email, password_hash, display_name, status, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [email, passwordHash, displayName],
      );
      const userId = String(result.insertId);
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roles[0].id]);
      await connection.execute(
        `INSERT INTO privacy_preferences (user_id, save_history, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)`, [userId],
      );
      await connection.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, occurred_at)
         VALUES (NULL, 'ADMIN_BOOTSTRAPPED', 'USER', ?, JSON_OBJECT('source', 'environment'), CURRENT_TIMESTAMP)`, [userId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

interface ExistingAdminRow extends RowDataPacket {
  id: string;
  status: string;
  email_verified_at: Date | null;
  role: string | null;
  role_count: number;
}
interface RoleRow extends RowDataPacket { id: number }
