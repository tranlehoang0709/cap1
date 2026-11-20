import 'reflect-metadata';
import { createPool, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';

const database = process.env.PA_ALERT_TEST_DATABASE;
const mysqlSuite = database ? describe : describe.skip;

mysqlSuite('PA alert sweep against a disposable 37-table MySQL clone', () => {
  let pool: Pool;

  beforeAll(() => {
    if (!database || !/^aiva_pa_alert_test_[a-z0-9_]+$/.test(database)) {
      throw new Error('PA_ALERT_TEST_DATABASE must name a dedicated disposable clone');
    }
    const host = process.env.PA_ALERT_TEST_HOST;
    const user = process.env.PA_ALERT_TEST_USER;
    if (!host || !user) throw new Error('Set dedicated test host and credentials');
    pool = createPool({
      host,
      user,
      port: Number(process.env.PA_ALERT_TEST_PORT ?? 3306),
      password: process.env.PA_ALERT_TEST_PASSWORD,
      database,
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates PA-22 and PA-15 alerts, then reuses their deliveries and cancels a completed task alert', async () => {
    const owner = process.env.PA_ALERT_TEST_OWNER_ID;
    if (!owner || !/^[1-9]\d*$/.test(owner)) throw new Error('Seed a test user and set PA_ALERT_TEST_OWNER_ID');

    const [tables] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    );
    expect(Number(tables[0].total)).toBe(37);
    const [counts] = await pool.execute<RowDataPacket[]>(`
      SELECT (SELECT COUNT(*) FROM personal_tasks) AS tasks,
             (SELECT COUNT(*) FROM personal_plans) AS plans,
             (SELECT COUNT(*) FROM personal_reminders) AS reminders,
             (SELECT COUNT(*) FROM reminder_deliveries) AS deliveries
    `);
    expect(Object.values(counts[0]).map(Number)).toEqual([0, 0, 0, 0]);

    const [plan] = await pool.execute<ResultSetHeader>(
      "INSERT INTO personal_plans (user_id, title, status) VALUES (?, 'PA test plan', 'active')", [owner]
    );
    const first = new Date('2026-01-15T12:00:00Z');
    const second = new Date(first.getTime() + 60_000);
    for (const number of [1, 2, 3]) {
      await pool.execute(
        'INSERT INTO personal_tasks (user_id, plan_id, session_number, title, due_at) VALUES (?, ?, ?, ?, ?)',
        [owner, String(plan.insertId), number, `Session ${number}`, new Date(first.getTime() - number * 3600_000)]
      );
    }
    const [standalone] = await pool.execute<ResultSetHeader>(
      'INSERT INTO personal_tasks (user_id, title, due_at) VALUES (?, ?, ?)',
      [owner, 'Deadline task '.repeat(13).trim(), new Date(first.getTime() + 12 * 3600_000)]
    );
    await pool.execute(
      "INSERT INTO personal_tasks (user_id, title, due_at, deleted_at) VALUES (?, 'Deleted task', ?, ?)",
      [owner, first, first]
    );

    const readAlerts = async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(`
        SELECT r.id, r.task_id, r.message, r.timezone, r.status AS reminder_status,
               d.delivery_channel, d.status AS delivery_status, d.idempotency_key
        FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id = r.id
        WHERE r.user_id = ? ORDER BY r.id
      `, [owner]);
      return rows;
    };

    const repository = new PersonalAssistantRepository(pool);
    await repository.sweepTaskAlerts(first);
    const before = await readAlerts();
    expect(before).toHaveLength(5);
    expect(before.filter(row => String(row.message).includes('[PA-22:'))).toHaveLength(4);
    expect(before.filter(row => String(row.message).includes('[PA-15:'))).toHaveLength(1);
    expect(before.find(row => String(row.task_id) === String(standalone.insertId))?.message).toContain('[PA-22:1d:');
    expect(new Set(before.map(row => row.idempotency_key)).size).toBe(5);
    for (const row of before) {
      expect(row).toMatchObject({
        timezone: 'UTC', delivery_channel: 'WEB', reminder_status: 'pending', delivery_status: 'pending',
      });
      expect(row.idempotency_key).toMatch(/^.{1,100}$/);
    }

    await pool.execute("UPDATE personal_tasks SET status = 'completed' WHERE id = ?", [String(standalone.insertId)]);
    await pool.execute(
      "UPDATE personal_tasks SET title = 'Renamed session' WHERE plan_id = ? AND session_number = 2",
      [String(plan.insertId)]
    );
    await repository.sweepTaskAlerts(second);
    const after = await readAlerts();
    expect(after.map(row => [row.id, row.idempotency_key])).toEqual(before.map(row => [row.id, row.idempotency_key]));
    for (const row of after) {
      const expected = String(row.task_id) === String(standalone.insertId) ? 'cancelled' : 'pending';
      expect(row).toMatchObject({ reminder_status: expected, delivery_status: expected });
    }
  });
});
