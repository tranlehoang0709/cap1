import { UsersService } from '../src/modules/users/users.service';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersServiceError } from '../src/modules/users/users.errors';
import { PublicUser, RoleRecord } from '../src/modules/users/users.types';

const verifiedUser = (id: string, status: PublicUser['status'] = 'active'): PublicUser => ({
  id,
  email: `${id}@example.test`,
  display_name: `User ${id}`,
  status,
  email_verified_at: new Date('2026-01-01T00:00:00.000Z'),
  last_login_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
});

const role = (code: 'ADMIN' | 'USER', id: number): RoleRecord => ({
  id,
  code,
  name: code === 'ADMIN' ? 'Administrator' : 'User',
});

describe('UsersService', () => {
  let repository: jest.Mocked<UsersRepository>;
  let service: UsersService;

  beforeEach(() => {
    const repositoryMock = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findUserRoles: jest.fn(),
      findRoleByCode: jest.fn(),
      findByIdForUpdate: jest.fn(),
      lockRoleByCode: jest.fn(),
      replaceUserRole: jest.fn(),
      updateStatus: jest.fn(),
      revokeAllSessions: jest.fn(),
      insertAuditLog: jest.fn(),
      countActiveAdmins: jest.fn(),
      withTransaction: jest.fn(),
    };
    repositoryMock.withTransaction.mockImplementation(async (work) => work(repository as unknown as UsersRepository));
    repository = repositoryMock as unknown as jest.Mocked<UsersRepository>;
    service = new UsersService(repository);
  });

  it('returns user data without exposing password_hash', async () => {
    repository.findById.mockResolvedValue(verifiedUser('7'));

    const user = await service.getUserById(7);

    expect(user).toEqual(verifiedUser('7'));
    expect(user).not.toHaveProperty('password_hash');
  });

  it('reports missing users and invalid role cardinality', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.getUserById(12)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });

    repository.findById.mockResolvedValue(verifiedUser('12'));
    repository.findUserRoles.mockResolvedValue([]);
    await expect(service.getUserRole(12)).rejects.toMatchObject({ code: 'ROLE_DATA_INCONSISTENT' });

    repository.findUserRoles.mockResolvedValue([role('USER', 2), role('ADMIN', 1)]);
    await expect(service.getUserRole(12)).rejects.toMatchObject({ code: 'ROLE_DATA_INCONSISTENT' });
  });

  it('allows login only for active users with verified email', async () => {
    repository.findById.mockResolvedValue(verifiedUser('5'));
    await expect(service.canLogin(5)).resolves.toEqual({ allowed: true, reason: null });

    repository.findById.mockResolvedValue({ ...verifiedUser('5'), email_verified_at: null });
    await expect(service.canLogin(5)).resolves.toEqual({ allowed: false, reason: 'EMAIL_NOT_VERIFIED' });

    repository.findById.mockResolvedValue(verifiedUser('5', 'suspended'));
    await expect(service.canLogin(5)).resolves.toEqual({ allowed: false, reason: 'ACCOUNT_SUSPENDED' });

    repository.findById.mockResolvedValue(verifiedUser('5', 'disabled'));
    await expect(service.canLogin(5)).resolves.toEqual({ allowed: false, reason: 'ACCOUNT_DISABLED' });
  });

  it('assigns the USER role to a user without a role and audits the assignment', async () => {
    repository.findByIdForUpdate.mockResolvedValue(verifiedUser('8'));
    repository.findUserRoles.mockResolvedValue([]);
    repository.findRoleByCode.mockResolvedValue(role('USER', 2));

    await expect(service.assignDefaultRole('8')).resolves.toBe('USER');

    expect(repository.replaceUserRole).toHaveBeenCalledWith('8', 2);
    expect(repository.insertAuditLog).toHaveBeenCalledWith(null, 'USER_ROLE_ASSIGNED', 'USER', '8', {
      previous_role: null,
      current_role: 'USER',
    });
    expect(repository.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not silently repair users who already have multiple roles', async () => {
    repository.findByIdForUpdate.mockResolvedValue(verifiedUser('8'));
    repository.findUserRoles.mockResolvedValue([role('USER', 2), role('ADMIN', 1)]);

    await expect(service.assignDefaultRole('8')).rejects.toMatchObject({ code: 'ROLE_DATA_INCONSISTENT' });
    expect(repository.replaceUserRole).not.toHaveBeenCalled();
  });

  it('changes a role in a transaction and records an audit entry', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => verifiedUser(String(id)));
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('USER', 2)]);
    repository.findRoleByCode.mockResolvedValue(role('ADMIN', 1));

    await expect(service.changeUserRole(1, 2, 'ADMIN')).resolves.toEqual({
      user_id: '2', previous_role: 'USER', current_role: 'ADMIN',
    });

    expect(repository.lockRoleByCode).toHaveBeenCalledWith('ADMIN');
    expect(repository.lockRoleByCode.mock.invocationCallOrder[0])
      .toBeLessThan(repository.findByIdForUpdate.mock.invocationCallOrder[0]);
    expect(repository.replaceUserRole).toHaveBeenCalledWith('2', 1);
    expect(repository.insertAuditLog).toHaveBeenCalledWith('1', 'USER_ROLE_CHANGED', 'USER', '2', {
      previous_role: 'USER',
      current_role: 'ADMIN',
    });
  });

  it('protects the last active Admin from demotion', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => verifiedUser(String(id)));
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('ADMIN', 1)]);
    repository.findRoleByCode.mockResolvedValue(role('USER', 2));
    repository.countActiveAdmins.mockResolvedValue(1);

    await expect(service.changeUserRole(1, 1, 'USER')).rejects.toMatchObject({ code: 'LAST_ADMIN_PROTECTED' });
    expect(repository.replaceUserRole).not.toHaveBeenCalled();
  });

  it('requires a persisted active Admin actor for role changes', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => verifiedUser(String(id)));
    repository.findUserRoles.mockResolvedValue([role('USER', 2)]);

    await expect(service.changeUserRole(1, 2, 'ADMIN')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.replaceUserRole).not.toHaveBeenCalled();
  });

  it('suspends a user, revokes all unrevoked sessions, and audits in one transaction', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => {
      return String(id) === '1' ? verifiedUser('1') : verifiedUser('2');
    });
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('USER', 2)]);
    const updatedAt = new Date('2026-03-01T10:00:00.000Z');
    repository.updateStatus.mockResolvedValue(updatedAt);
    repository.revokeAllSessions.mockResolvedValue(3);

    await expect(service.changeAccountStatus(1, 2, 'suspended')).resolves.toEqual({
      user_id: '2',
      previous_status: 'active',
      current_status: 'suspended',
      sessions_revoked: 3,
      updated_at: updatedAt,
    });
    expect(repository.updateStatus).toHaveBeenCalledWith('2', 'suspended');
    expect(repository.revokeAllSessions).toHaveBeenCalledWith('2');
    expect(repository.insertAuditLog).toHaveBeenCalledWith('1', 'USER_STATUS_CHANGED', 'USER', '2', {
      previous_status: 'active',
      current_status: 'suspended',
      sessions_revoked: 3,
    });
  });

  it('protects the last active Admin from account suspension', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => verifiedUser(String(id)));
    repository.findUserRoles.mockResolvedValue([role('ADMIN', 1)]);
    repository.countActiveAdmins.mockResolvedValue(1);

    await expect(service.changeAccountStatus(1, 1, 'disabled')).rejects.toMatchObject({
      code: 'LAST_ADMIN_PROTECTED',
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(repository.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('restores a disabled user without creating sessions or verifying email', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => {
      return String(id) === '1' ? verifiedUser('1') : { ...verifiedUser('2', 'disabled'), email_verified_at: null };
    });
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('USER', 2)]);
    const updatedAt = new Date('2026-03-02T10:00:00.000Z');
    repository.updateStatus.mockResolvedValue(updatedAt);

    await expect(service.changeAccountStatus(1, 2, 'active')).resolves.toMatchObject({
      previous_status: 'disabled',
      current_status: 'active',
      sessions_revoked: 0,
    });
    expect(repository.revokeAllSessions).not.toHaveBeenCalled();
    expect(repository.insertAuditLog).toHaveBeenCalled();
  });

  it('rejects disabled to suspended and unknown statuses', async () => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => {
      return String(id) === '1' ? verifiedUser('1') : verifiedUser('2', 'disabled');
    });
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('USER', 2)]);

    await expect(service.changeAccountStatus(1, 2, 'suspended')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    await expect(service.changeAccountStatus(1, 2, 'pending')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['active', 'disabled', 2],
    ['suspended', 'active', 0],
    ['suspended', 'disabled', 4],
  ] as const)('applies the allowed status transition %s -> %s', async (previousStatus, nextStatus, revokedCount) => {
    repository.lockRoleByCode.mockResolvedValue(role('ADMIN', 1));
    repository.findByIdForUpdate.mockImplementation(async (id) => {
      return String(id) === '1' ? verifiedUser('1') : verifiedUser('2', previousStatus);
    });
    repository.findUserRoles.mockImplementation(async (id) => [String(id) === '1' ? role('ADMIN', 1) : role('USER', 2)]);
    const updatedAt = new Date('2026-03-03T10:00:00.000Z');
    repository.updateStatus.mockResolvedValue(updatedAt);
    repository.revokeAllSessions.mockResolvedValue(revokedCount);

    const result = await service.changeAccountStatus(1, 2, nextStatus);

    expect(result.previous_status).toBe(previousStatus);
    expect(result.current_status).toBe(nextStatus);
    expect(result.sessions_revoked).toBe(revokedCount);
    if (nextStatus === 'active') {
      expect(repository.revokeAllSessions).not.toHaveBeenCalled();
    } else {
      expect(repository.revokeAllSessions).toHaveBeenCalledWith('2');
    }
  });

  it('rejects invalid and unsafe user IDs without querying the database', async () => {
    await expect(service.getUserById(0)).rejects.toBeInstanceOf(UsersServiceError);
    await expect(service.getUserById(Number.MAX_SAFE_INTEGER + 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.getUserRole('not-an-id')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
