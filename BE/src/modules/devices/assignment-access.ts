import { ForbiddenException } from '@nestjs/common';
import { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { OwnershipTransaction } from './ownership.repository';

/** Lock parent devices before reading configuration/history, serializing with revoke. */
export async function lockUserDevices(pool: Pool, connection: PoolConnection, userId: string) {
  const [ids] = await connection.execute<RowDataPacket[]>(
    'SELECT CAST(device_id AS CHAR) AS id FROM device_assignments WHERE user_id=? ORDER BY device_id', [userId]);
  const ownership = new OwnershipTransaction(pool, connection);
  let approved = false;
  for (const row of ids) {
    await ownership.devices.findDeviceById(row.id);
    if (await ownership.verifyDeviceOwnership(userId, row.id)) approved = true;
  }
  return approved;
}

export async function requireApprovedRobot(pool: Pool, connection: PoolConnection, userId: string) {
  if (!await lockUserDevices(pool, connection, userId)) throw new ForbiddenException('NO_APPROVED_DEVICE');
  const ownership = new OwnershipTransaction(pool, connection);
  const user = await ownership.devices.users.findByIdForUpdate(userId);
  const roles = user ? await ownership.devices.users.findUserRoles(userId) : [];
  if (!user || user.status !== 'active' || user.email_verified_at === null || roles.length !== 1 || roles[0].code !== 'USER') {
    throw new ForbiddenException('Active verified USER required');
  }
}

// Robot history and live context both require the current open assignment.
// Legacy robot rows without an assignment ID fail closed; web rows stay user-scoped.
export const visibleConversation = `(c.device_id IS NULL AND LOWER(c.channel)='web'
  OR c.device_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM device_assignment_history h
    JOIN device_assignments a ON a.device_id=h.device_id AND a.user_id=h.user_id
      AND a.pairing_request_id=h.pairing_request_id AND a.assigned_at=h.assigned_at
    JOIN devices d ON d.id=a.device_id
    JOIN device_pairing_requests p ON p.id=a.pairing_request_id AND p.device_id=a.device_id AND p.user_id=a.user_id
    WHERE h.id=c.assignment_history_id AND h.device_id=c.device_id AND h.user_id=c.user_id
      AND h.unlinked_at IS NULL AND p.status='approved' AND d.lifecycle_status='assigned'
      AND NOT EXISTS (SELECT 1 FROM device_unlink_operations o WHERE o.device_id=d.id
        AND (o.status<>'completed' OR o.revoked_at IS NULL OR o.completed_at IS NULL))
      AND NOT EXISTS (SELECT 1 FROM device_reset_jobs j WHERE j.device_id=d.id
        AND j.id=(SELECT MAX(j2.id) FROM device_reset_jobs j2 WHERE j2.device_id=d.id)
        AND (j.status<>'acknowledged' OR j.acknowledged_at IS NULL))))`;

// Keep a shared alias so list/detail/delete cannot diverge from session checks.
export const ownedConversationHistory = visibleConversation;
