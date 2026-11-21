import { createPool, Pool, ResultSetHeader } from 'mysql2/promise';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { CalendarRepository } from '../src/modules/calendar/calendar.repository';
import { CalendarService, ReminderService } from '../src/modules/calendar/calendar.service';
import { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { OwnershipRepository } from '../src/modules/devices/ownership.repository';
import { OwnershipService } from '../src/modules/devices/ownership.service';

const suite = process.env.AIVA_CALENDAR_ISOLATED_MYSQL === '1' ? describe : describe.skip;

suite('Calendar and reminder persistence on the isolated 37-table schema', () => {
  let pool: Pool;
  const connect = () => createPool({
    host: '127.0.0.1',
    port: 43316,
    database: 'aiva_calendar_isolated_test',
    user: 'root',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  async function fixtureUser(label: string): Promise<AuthenticatedUser> {
    const display_name = 'Calendar test ' + label;
    const email = `${label}-${randomUUID()}@example.invalid`;
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (email, password_hash, display_name, created_at, updated_at)
       VALUES (?, 'test-fixture', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [email, display_name]);
    return { id: String(result.insertId), email, display_name, role: 'USER' };
  }

  async function fixtureDevice(owner: AuthenticatedUser) {
    const deviceUid = 'receipt-test-' + randomUUID();
    const credential = randomBytes(32).toString('base64url');
    await pool.execute("INSERT IGNORE INTO roles (code, name) VALUES ('USER', 'User')");
    await pool.execute("INSERT IGNORE INTO user_roles SELECT ?, id FROM roles WHERE code = 'USER'", [owner.id]);
    await pool.execute('UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?', [owner.id]);
    const [device] = await pool.execute<ResultSetHeader>(`
      INSERT INTO devices (device_uid, lifecycle_status, created_at, updated_at)
      VALUES (?, 'assigned', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [deviceUid]);
    const deviceId = String(device.insertId);
    await pool.execute('INSERT INTO device_credentials (device_id, credential_hash, created_at) VALUES (?, ?, UTC_TIMESTAMP())',
      [deviceId, createHash('sha256').update(credential).digest('hex')]);
    const [code] = await pool.execute<ResultSetHeader>(`
      INSERT INTO device_pairing_codes (device_id, code_hash, expires_at, created_at)
      VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), UTC_TIMESTAMP())`, [deviceId, randomUUID()]);
    const [request] = await pool.execute<ResultSetHeader>(`
      INSERT INTO device_pairing_requests (device_id, user_id, pairing_code_id, status, created_at)
      VALUES (?, ?, ?, 'approved', UTC_TIMESTAMP())`, [deviceId, owner.id, code.insertId]);
    await pool.execute(`
      INSERT INTO device_assignments (device_id, user_id, pairing_request_id, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`, [deviceId, owner.id, request.insertId, owner.id]);
    return { deviceId, deviceUid, credential };
  }

  beforeAll(() => { pool = connect(); });
  afterAll(async () => { await pool?.end(); });

  it('commits events and reminder receipts across separate connections, preserving ownership and replay semantics', async () => {
    const owner = await fixtureUser('owner');
    const other = await fixtureUser('other');
    const firstRepository = new CalendarRepository(pool);
    const firstCalendar = new CalendarService(firstRepository);
    const created = await firstCalendar.createEvent(owner, {
      title: 'Schedule fixture',
      starts_at: '2090-01-15T16:00:00+07:00',
      ends_at: '2090-01-15T17:00:00+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    if (!created) throw new Error('Event was not committed');
    const reminder = await new ReminderService(firstRepository).create(owner, {
      message: 'Reminder fixture',
      calendar_event_id: String(created.id),
      remind_at: '2090-01-15T15:00:00+07:00',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    if (!reminder) throw new Error('Reminder was not committed');
    await pool.end();
    pool = connect();

    const secondRepository = new CalendarRepository(pool);
    const secondCalendar = new CalendarService(secondRepository);
    const secondReminder = new ReminderService(secondRepository);
    const { items } = await secondCalendar.listEvents(owner, '2090-01-15T00:00:00+07:00', '2090-01-16T00:00:00+07:00');
    expect(items.map(item => item.id)).toContain(created.id);
    expect((await secondCalendar.listEvents(other)).items).toEqual([]);
    expect((await secondCalendar.updateEvent(owner, String(created.id), { title: 'Updated fixture' }))?.title)
      .toBe('Updated fixture');
    const { items: deliveries } = await secondReminder.list(owner);
    const deliveryId = deliveries.find(row => row.id === reminder.id)?.delivery_id;
    if (!deliveryId) throw new Error('Delivery was not committed');
    await expect(secondReminder.confirmReceipt(other, String(reminder.id), deliveryId)).rejects.toMatchObject({ status: 404 });
    await expect(secondReminder.confirmReceipt(owner, String(reminder.id), deliveryId)).rejects.toMatchObject({ status: 409 });

    await pool.execute("UPDATE reminder_deliveries SET status = 'queued' WHERE id = ?", [deliveryId]);
    expect((await secondReminder.ack(String(reminder.id), 'delivered'))?.status).toBe('delivered');
    const receipt = await secondReminder.confirmReceipt(owner, String(reminder.id), deliveryId);
    await secondCalendar.deleteEvent(owner, String(created.id));
    await pool.end();
    pool = connect();

    const thirdRepository = new CalendarRepository(pool);
    expect(await new ReminderService(thirdRepository).confirmReceipt(owner, String(reminder.id), deliveryId)).toEqual(receipt);
    expect(await thirdRepository.findEvent(owner.id, String(created.id))).toBeNull();
  });

  it('binds a voice receipt to the authorized owner and delivery device and serializes concurrent retries', async () => {
    const owner = await fixtureUser('voice-owner');
    const other = await fixtureUser('voice-other');
    const { deviceId, ...proof } = await fixtureDevice(owner);
    const { deviceId: _different, ...differentProof } = await fixtureDevice(owner);
    const { deviceId: _other, ...otherProof } = await fixtureDevice(other);
    const repository = new CalendarRepository(pool);
    const reminder = await new ReminderService(repository).create(owner, {
      message: 'Voice receipt fixture', device_id: deviceId, remind_at: '2090-02-15T15:00:00+07:00',
    });
    if (!reminder) throw new Error('Reminder was not committed');
    const delivery = (await repository.listReminders(owner.id)).find(row => row.id === reminder.id);
    if (!delivery?.delivery_id) throw new Error('Delivery was not committed');

    const config = new ConfigService({ DEVICE_AUTH_CONTRACT_APPROVED: 'true' });
    const ownership = () => new OwnershipService(new OwnershipRepository(pool), config);
    const request = { ...proof, expectedOwner: owner.id, reminderId: String(reminder.id), deliveryId: delivery.delivery_id };
    await expect(ownership().reminderReceipt({ ...request, ...otherProof })).rejects.toMatchObject({ status: 403 });
    await expect(ownership().reminderReceipt({ ...request, ...otherProof, expectedOwner: other.id })).rejects.toMatchObject({ status: 404 });
    await expect(ownership().reminderReceipt({ ...request, ...differentProof })).rejects.toMatchObject({ status: 404 });
    await expect(ownership().reminderReceipt(request)).rejects.toMatchObject({ status: 409 });
    await pool.execute("UPDATE reminder_deliveries SET status = 'sent' WHERE id = ?", [delivery.delivery_id]);
    const [first, retry] = await Promise.all([
      ownership().reminderReceipt(request), ownership().reminderReceipt(request),
    ]);
    expect(first).toEqual(retry);
    expect(first.status).toBe('acknowledged');
    await pool.end();
    pool = connect();
    expect(await ownership().reminderReceipt(request)).toEqual(first);
  });

  it('permits only one conflicting authenticated Calendar create across connections', async () => {
    const owner = await fixtureUser('concurrent-calendar');
    const calendar = new CalendarService(new CalendarRepository(pool));
    const event = { title: 'Concurrent fixture', starts_at: '2090-04-15T09:00:00Z',
      ends_at: '2090-04-15T10:00:00Z' };
    const results = await Promise.allSettled([calendar.createEvent(owner, event), calendar.createEvent(owner, event)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await calendar.listEvents(owner)).items).toHaveLength(1);
  });
});
