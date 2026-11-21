import { ConflictException, NotFoundException } from '@nestjs/common';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

export async function recordReminderReceipt(
  connection: PoolConnection, userId: string, reminderId: string, deliveryId: string, deviceId?: string,
) {
  const [rows] = await connection.execute<RowDataPacket[]>(`
    SELECT d.status, d.acknowledged_at
    FROM reminder_deliveries d JOIN personal_reminders r ON r.id = d.reminder_id
    WHERE r.user_id = ? AND r.id = ? AND d.id = ?
      ${deviceId ? "AND d.device_id = ? AND d.delivery_channel = 'VOICE'" : ''}
    FOR UPDATE`, deviceId ? [userId, reminderId, deliveryId, deviceId] : [userId, reminderId, deliveryId]);
  const delivery = rows[0];
  if (!delivery) throw new NotFoundException('Reminder delivery not found');
  if (!['sent', 'delivered', 'acknowledged'].includes(delivery.status)) {
    throw new ConflictException('Reminder delivery has not been sent');
  }
  let acknowledgedAt: Date | null = delivery.acknowledged_at;
  if (delivery.status !== 'acknowledged' || !acknowledgedAt) {
    const [time] = await connection.execute<RowDataPacket[]>('SELECT UTC_TIMESTAMP() AS acknowledged_at');
    acknowledgedAt = delivery.acknowledged_at ?? time[0].acknowledged_at;
    await connection.execute(`
      UPDATE reminder_deliveries SET status = 'acknowledged', acknowledged_at = ?,
             last_error = NULL, next_retry_at = NULL
      WHERE id = ? AND reminder_id = ?`, [acknowledgedAt, deliveryId, reminderId]);
  }
  return { reminderId, deliveryId, status: 'acknowledged' as const, acknowledgedAt };
}
