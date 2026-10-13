import { Inject, Injectable, Optional } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { AccountStatus, AuditMetadata, PublicUser, RoleCode, RoleRecord, UserId, UserWithCredential } from './users.types';

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(MYSQL_POOL) private readonly pool: Pool,
    @Optional()
    private readonly transactionConnection?: PoolConnection,
  ) {}

  private get executor(): Pool | PoolConnection {
    return this.transactionConnection ?? this.pool;
  }

  private async selectRows<T extends RowDataPacket>(sql: string, values: unknown[] = []): Promise<T[]> {
    const [rows] = await this.executor.execute(sql, values as never[]);
    return rows as T[];
  }

  async findById(userId: UserId): Promise<PublicUser | null> {
    const rows = await this.selectRows<PublicUserRow>(
      `SELECT id, email, display_name, status, email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    return rows[0] ? this.toPublicUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<UserWithCredential | null> {
    const rows = await this.selectRows<UserWithCredentialRow>(
      `SELECT id, email, password_hash, display_name, status, email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE email = ? LIMIT 1`,
      [email],
    );
    return rows[0] ? this.toUserWithCredential(rows[0]) : null;
  }

  async findUserRoles(userId: UserId): Promise<RoleRecord[]> {
    const rows = await this.selectRows<RoleRow>(
      `SELECT r.id, r.code, r.name
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?
       ORDER BY r.code`,
      [userId],
    );
    return rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name }));
  }

  async findRoleByCode(code: RoleCode): Promise<RoleRecord | null> {
    const rows = await this.selectRows<RoleRow>(
      'SELECT id, code, name FROM roles WHERE code = ? LIMIT 1',
      [code],
    );
    return rows[0] ? { id: Number(rows[0].id), code: rows[0].code, name: rows[0].name } : null;
  }

  async findByIdForUpdate(userId: UserId): Promise<PublicUser | null> {
    const rows = await this.selectRows<PublicUserRow>(
      `SELECT id, email, display_name, status, email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
      [userId],
    );
    return rows[0] ? this.toPublicUser(rows[0]) : null;
  }

  async lockRoleByCode(code: RoleCode): Promise<RoleRecord | null> {
    const rows = await this.selectRows<RoleRow>(
      'SELECT id, code, name FROM roles WHERE code = ? LIMIT 1 FOR UPDATE',
      [code],
    );
    return rows[0] ? { id: Number(rows[0].id), code: rows[0].code, name: rows[0].name } : null;
  }

  async replaceUserRole(userId: UserId, roleId: number): Promise<void> {
    await this.executor.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    await this.executor.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, roleId],
    );
  }

  async updateStatus(userId: UserId, status: AccountStatus): Promise<Date> {
    await this.executor.execute(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, userId],
    );
    const user = await this.findByIdForUpdate(userId);
    if (!user) {
      throw new Error('User disappeared while its row lock was held');
    }
    return user.updated_at;
  }

  async revokeAllSessions(userId: UserId): Promise<number> {
    const [result] = await this.executor.execute<ResultSetHeader>(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND revoked_at IS NULL`,
      [userId],
    );
    return result.affectedRows;
  }

  async insertAuditLog(
    actorUserId: UserId | null,
    action: string,
    entityType: string,
    entityId: string,
    metadata: AuditMetadata,
  ): Promise<void> {
    await this.executor.execute(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, occurred_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [actorUserId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }

  async countActiveAdmins(): Promise<number> {
    const rows = await this.selectRows<CountRow>(
      `SELECT COUNT(DISTINCT u.id) AS total
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'ADMIN' AND u.status = 'active'`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async withTransaction<T>(work: (transaction: UsersRepository) => Promise<T>): Promise<T> {
    if (this.transactionConnection) {
      throw new Error('Nested user repository transactions are not supported');
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const transactionRepository = new UsersRepository(this.pool, connection);
      try {
        const result = await work(transactionRepository);
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Database transaction and rollback both failed');
        }
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  private toPublicUser(row: PublicUserRow): PublicUser {
    return {
      id: String(row.id),
      email: row.email,
      display_name: row.display_name,
      status: row.status,
      email_verified_at: row.email_verified_at,
      last_login_at: row.last_login_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toUserWithCredential(row: UserWithCredentialRow): UserWithCredential {
    return { ...this.toPublicUser(row), password_hash: row.password_hash };
  }
}

interface PublicUserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  status: AccountStatus;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface UserWithCredentialRow extends PublicUserRow {
  password_hash: string;
}

interface RoleRow extends RowDataPacket {
  id: number;
  code: RoleCode;
  name: string;
}

interface CountRow extends RowDataPacket {
  total: number | string;
}
