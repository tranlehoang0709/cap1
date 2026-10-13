import { Injectable } from '@nestjs/common';
import { UsersServiceError } from './users.errors';
import { UsersRepository } from './users.repository';
import {
  AccountStatus,
  CanLoginResult,
  ChangeRoleResult,
  ChangeStatusResult,
  PublicUser,
  RoleCode,
  RoleRecord,
  UserId,
} from './users.types';

const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'suspended', 'disabled'];
const ROLE_CODES: readonly RoleCode[] = ['ADMIN', 'USER'];

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getUserById(id: UserId): Promise<PublicUser> {
    const userId = this.normalizeUserId(id);
    return this.withDatabaseErrors(async () => {
      const user = await this.usersRepository.findById(userId);
      if (!user) {
        throw new UsersServiceError('USER_NOT_FOUND', 'User was not found');
      }
      return user;
    });
  }

  async getUserRole(id: UserId): Promise<RoleCode> {
    const userId = this.normalizeUserId(id);
    return this.withDatabaseErrors(async () => {
      const user = await this.usersRepository.findById(userId);
      if (!user) {
        throw new UsersServiceError('USER_NOT_FOUND', 'User was not found');
      }
      const role = this.requireSingleRole(await this.usersRepository.findUserRoles(userId));
      return role.code;
    });
  }

  async isEmailVerified(id: UserId): Promise<boolean> {
    const user = await this.getUserById(id);
    return user.email_verified_at !== null;
  }

  async canLogin(id: UserId): Promise<CanLoginResult> {
    const user = await this.getUserById(id);
    if (user.status === 'suspended') {
      return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
    }
    if (user.status === 'disabled') {
      return { allowed: false, reason: 'ACCOUNT_DISABLED' };
    }
    if (user.status !== 'active') {
      return { allowed: false, reason: 'INVALID_STATUS' };
    }
    if (user.email_verified_at === null) {
      return { allowed: false, reason: 'EMAIL_NOT_VERIFIED' };
    }
    return { allowed: true, reason: null };
  }

  /** Call only for a newly created user as part of the account-creation flow. */
  async assignDefaultRole(id: UserId): Promise<RoleCode> {
    const userId = this.normalizeUserId(id);
    return this.withDatabaseErrors<RoleCode>(() => this.usersRepository.withTransaction<RoleCode>(async (transaction) => {
      const user = await transaction.findByIdForUpdate(userId);
      if (!user) {
        throw new UsersServiceError('USER_NOT_FOUND', 'User was not found');
      }

      const existingRoles = await transaction.findUserRoles(userId);
      if (existingRoles.length > 1) {
        throw new UsersServiceError('ROLE_DATA_INCONSISTENT', 'User has more than one role');
      }
      if (existingRoles.length === 1) {
        const existingRole = this.requireSingleRole(existingRoles);
        if (existingRole.code === 'USER') {
          return 'USER';
        }
        throw new UsersServiceError('INVALID_ROLE', 'A user who already has a role cannot be assigned the default role');
      }

      const defaultRole = await transaction.findRoleByCode('USER');
      if (!defaultRole) {
        throw new UsersServiceError('ROLE_NOT_FOUND', 'USER role was not found');
      }
      await transaction.replaceUserRole(userId, defaultRole.id);
      await transaction.insertAuditLog(null, 'USER_ROLE_ASSIGNED', 'USER', userId, {
        previous_role: null,
        current_role: 'USER',
      });
      return 'USER';
    }));
  }

  async changeUserRole(actorId: UserId, targetUserId: UserId, requestedRole: string): Promise<ChangeRoleResult> {
    const actor = this.normalizeUserId(actorId);
    const target = this.normalizeUserId(targetUserId);
    if (!ROLE_CODES.includes(requestedRole as RoleCode)) {
      throw new UsersServiceError('INVALID_ROLE', 'Role must be ADMIN or USER');
    }
    const newRole = requestedRole as RoleCode;

    return this.withDatabaseErrors(() => this.usersRepository.withTransaction(async (transaction) => {
      await this.lockAdminRole(transaction);
      const users = await this.lockActorAndTarget(transaction, actor, target);
      this.assertActiveAdmin(users.actor, users.actorRoles);

      const targetRoles = this.requireSingleRole(await transaction.findUserRoles(target));
      const currentRole = targetRoles.code;
      if (currentRole === newRole) {
        return { user_id: target, previous_role: currentRole, current_role: currentRole };
      }

      const role = await transaction.findRoleByCode(newRole);
      if (!role) {
        throw new UsersServiceError('ROLE_NOT_FOUND', `${newRole} role was not found`);
      }
      if (currentRole === 'ADMIN' && newRole === 'USER' && users.target.status === 'active') {
        if (await transaction.countActiveAdmins() <= 1) {
          throw new UsersServiceError('LAST_ADMIN_PROTECTED', 'The last active Admin cannot be demoted');
        }
      }

      await transaction.replaceUserRole(target, role.id);
      await transaction.insertAuditLog(actor, 'USER_ROLE_CHANGED', 'USER', target, {
        previous_role: currentRole,
        current_role: newRole,
      });
      return { user_id: target, previous_role: currentRole, current_role: newRole };
    }));
  }

  async changeAccountStatus(
    actorId: UserId,
    targetUserId: UserId,
    requestedStatus: string,
  ): Promise<ChangeStatusResult> {
    const actor = this.normalizeUserId(actorId);
    const target = this.normalizeUserId(targetUserId);
    if (!ACCOUNT_STATUSES.includes(requestedStatus as AccountStatus)) {
      throw new UsersServiceError('INVALID_STATUS', 'Status must be active, suspended, or disabled');
    }
    const newStatus = requestedStatus as AccountStatus;

    return this.withDatabaseErrors(() => this.usersRepository.withTransaction(async (transaction) => {
      await this.lockAdminRole(transaction);
      const users = await this.lockActorAndTarget(transaction, actor, target);
      this.assertActiveAdmin(users.actor, users.actorRoles);

      const targetRole = this.requireSingleRole(await transaction.findUserRoles(target));
      const previousStatus = users.target.status;
      if (previousStatus === newStatus) {
        return {
          user_id: target,
          previous_status: previousStatus,
          current_status: newStatus,
          sessions_revoked: 0,
          updated_at: users.target.updated_at,
        };
      }
      if (!this.isAllowedTransition(previousStatus, newStatus)) {
        throw new UsersServiceError('INVALID_STATUS', `Transition ${previousStatus} -> ${newStatus} is not allowed`);
      }
      if (
        targetRole.code === 'ADMIN'
        && previousStatus === 'active'
        && newStatus !== 'active'
        && await transaction.countActiveAdmins() <= 1
      ) {
        throw new UsersServiceError('LAST_ADMIN_PROTECTED', 'The last active Admin cannot be suspended or disabled');
      }

      const updatedAt = await transaction.updateStatus(target, newStatus);
      const sessionsRevoked = newStatus === 'active' ? 0 : await transaction.revokeAllSessions(target);
      await transaction.insertAuditLog(actor, 'USER_STATUS_CHANGED', 'USER', target, {
        previous_status: previousStatus,
        current_status: newStatus,
        sessions_revoked: sessionsRevoked,
      });
      return {
        user_id: target,
        previous_status: previousStatus,
        current_status: newStatus,
        sessions_revoked: sessionsRevoked,
        updated_at: updatedAt,
      };
    }));
  }

  private async lockAdminRole(transaction: UsersRepository): Promise<RoleRecord> {
    const adminRole = await transaction.lockRoleByCode('ADMIN');
    if (!adminRole) {
      throw new UsersServiceError('ROLE_NOT_FOUND', 'ADMIN role was not found');
    }
    return adminRole;
  }

  private async lockActorAndTarget(
    transaction: UsersRepository,
    actorId: string,
    targetId: string,
  ): Promise<{ actor: PublicUser; target: PublicUser; actorRoles: RoleRecord[] }> {
    const ids = actorId === targetId
      ? [actorId]
      : [actorId, targetId].sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
    const locked = new Map<string, PublicUser | null>();
    for (const id of ids) {
      locked.set(id, await transaction.findByIdForUpdate(id));
    }

    const actor = locked.get(actorId);
    if (!actor) {
      throw new UsersServiceError('FORBIDDEN', 'Actor is not authorized to manage users');
    }
    const target = locked.get(targetId);
    if (!target) {
      throw new UsersServiceError('USER_NOT_FOUND', 'User was not found');
    }
    const actorRoles = await transaction.findUserRoles(actorId);
    return { actor, target, actorRoles };
  }

  private assertActiveAdmin(user: PublicUser, roles: RoleRecord[]): void {
    const role = this.requireSingleRole(roles);
    if (role.code !== 'ADMIN' || user.status !== 'active' || user.email_verified_at === null) {
      throw new UsersServiceError('FORBIDDEN', 'An active, email-verified Admin account is required');
    }
  }

  private requireSingleRole(roles: RoleRecord[]): RoleRecord {
    if (roles.length !== 1 || !ROLE_CODES.includes(roles[0].code)) {
      throw new UsersServiceError('ROLE_DATA_INCONSISTENT', 'User must have exactly one recognized role');
    }
    return roles[0];
  }

  private isAllowedTransition(previous: AccountStatus, next: AccountStatus): boolean {
    if (!ACCOUNT_STATUSES.includes(previous) || !ACCOUNT_STATUSES.includes(next)) {
      return false;
    }
    const transitions: Record<AccountStatus, readonly AccountStatus[]> = {
      active: ['suspended', 'disabled'],
      suspended: ['active', 'disabled'],
      disabled: ['active'],
    };
    return transitions[previous].includes(next);
  }

  private normalizeUserId(id: UserId): string {
    if (typeof id === 'number' && (!Number.isSafeInteger(id) || id <= 0)) {
      throw new UsersServiceError('INVALID_INPUT', 'User ID must be a positive safe integer or decimal string');
    }
    if (typeof id !== 'number' && !/^\d+$/.test(id)) {
      throw new UsersServiceError('INVALID_INPUT', 'User ID must be a positive integer');
    }
    let normalized: bigint;
    try {
      normalized = BigInt(id);
    } catch {
      throw new UsersServiceError('INVALID_INPUT', 'User ID must be a positive integer');
    }
    if (normalized <= 0n || normalized > 9223372036854775807n) {
      throw new UsersServiceError('INVALID_INPUT', 'User ID is outside the supported BIGINT range');
    }
    return normalized.toString();
  }

  private async withDatabaseErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof UsersServiceError) {
        throw error;
      }
      throw new UsersServiceError('DATABASE_ERROR', 'A database operation failed');
    }
  }
}
