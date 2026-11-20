import 'reflect-metadata';
import { createConnection, Connection, Pool } from 'mysql2/promise';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';

const mysqlSuite = process.env.PA_SWEEP_TEST_DATABASE ? describe : describe.skip;

mysqlSuite('PA sweeper on canonical MySQL schema (outer transaction always rolled back)', () => {
  let connection: Connection;
  let repository: PersonalAssistantRepository;
  let owner: string;
  const now = new Date('2026-01-15T12:00:00Z');
  const sql = async (query: string, values: any[] = []): Promise<any> =>
    (await connection.execute(query, values))[0];

  beforeAll(async () => {
    const database = process.env.PA_SWEEP_TEST_DATABASE;
    if (!database || !/^aiva_pa_sweep_test_[a-z0-9_]+$/.test(database) ||
        !process.env.PA_TEST_HOST || !process.env.PA_TEST_USER) {
      throw new Error('Explicit isolated PA sweep test connection required');
    }
    connection = await createConnection({
      host: process.env.PA_TEST_HOST, port: Number(process.env.PA_TEST_PORT || 3306),
      user: process.env.PA_TEST_USER, password: process.env.PA_TEST_PASSWORD,
      database, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    });
    const [identity] = await connection.query<any[]>('SELECT DATABASE() AS db');
    expect(identity[0].db).toBe(database);
    const [tables] = await connection.query<any[]>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND ENGINE<>\'InnoDB\''
    );
    expect(tables).toEqual([]);
    await connection.beginTransaction();
    const user = await sql(`INSERT INTO users (email,password_hash,display_name,status,created_at,updated_at)
      VALUES ('pa-sweep@example.invalid','fixture','PA Sweep','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`);
    owner = String(user.insertId);
    // The real repository uses its normal transaction calls. SAVEPOINTs keep all
    // fixture writes inside one outer test transaction, including its "commit".
    const adapter = {
      execute: (q: string, v: any[]) => connection.execute(q, v),
      beginTransaction: () => connection.query('SAVEPOINT pa_sweep'),
      commit: () => connection.query('RELEASE SAVEPOINT pa_sweep'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT pa_sweep'),
      release: () => {},
    };
    repository = new PersonalAssistantRepository({
      execute: adapter.execute, getConnection: async () => adapter,
    } as unknown as Pool);
  });

  afterAll(async () => {
    if (!connection) return;
    try {
      await connection.rollback();
      const [rows] = await connection.execute<any[]>(
        'SELECT COUNT(*) AS total FROM users WHERE email=?', ['pa-sweep@example.invalid']
      );
      expect(Number(rows[0].total)).toBe(0);
    } finally { await connection.end(); }
  });

  it('creates alerts, avoids duplicates, ignores deleted/closed tasks, cancels stale alerts and acknowledges delivery', async () => {
    const plan = await sql("INSERT INTO personal_plans (user_id,title) VALUES (?, 'Plan')", [owner]);
    for (const n of [1, 2, 3]) {
      await sql(`INSERT INTO personal_tasks (user_id,plan_id,session_number,title,due_at)
        VALUES (?,?,?,?,?)`, [owner, plan.insertId, n, `Session ${n}`, new Date(now.getTime() - n * 3600000)]);
    }
    const ids: string[] = [];
    for (const hours of [-1, 12, 48]) {
      const task = await sql('INSERT INTO personal_tasks (user_id,title,due_at) VALUES (?,?,?)',
        [owner, `Standalone ${hours}`, new Date(now.getTime() + hours * 3600000)]);
      ids.push(String(task.insertId));
    }
    for (const status of ['completed', 'cancelled']) {
      await sql('INSERT INTO personal_tasks (user_id,title,status,due_at) VALUES (?,?,?,?)', [owner, status, status, now]);
    }
    await sql('INSERT INTO personal_tasks (user_id,title,due_at,deleted_at) VALUES (?,?,?,?)', [owner, 'Deleted', now, now]);
    const alerts = () => sql(`SELECT r.id,r.task_id,r.message,r.channel,r.status,d.status AS delivery_status
      FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id
      WHERE r.user_id=? ORDER BY r.id`, [owner]);

    await repository.sweepTaskAlerts(now);
    const first = await alerts();
    expect(first).toHaveLength(7);
    expect(first.filter((r: any) => r.message.includes('[PA-22:'))).toHaveLength(6);
    expect(first.filter((r: any) => r.message.includes('[PA-15:'))).toHaveLength(1);
    for (const stage of ['overdue', '1d', '3d']) expect(first.some((r: any) => r.message.includes(`[PA-22:${stage}:`))).toBe(true);
    for (const row of first) expect(row).toMatchObject({ channel: 'WEB', status: 'pending', delivery_status: 'pending' });

    await repository.sweepTaskAlerts(new Date(now.getTime() + 60000));
    expect((await alerts()).map((r: any) => r.id)).toEqual(first.map((r: any) => r.id));

    await sql("UPDATE personal_tasks SET status='completed' WHERE id=?", [ids[0]]);
    await sql('UPDATE personal_tasks SET due_at=? WHERE id=?', [new Date(now.getTime() + 13 * 3600000), ids[1]]);
    await sql('UPDATE personal_tasks SET deleted_at=? WHERE id=?', [now, ids[2]]);
    await sql("UPDATE personal_tasks SET status='completed' WHERE plan_id=? AND session_number=2", [plan.insertId]);
    await repository.sweepTaskAlerts(new Date(now.getTime() + 120000));
    const changed = await alerts();
    for (const row of first.filter((r: any) => ids.includes(String(r.task_id)) || r.message.includes('[PA-15:'))) {
      expect(changed.find((r: any) => r.id === row.id)).toMatchObject({ status: 'cancelled', delivery_status: 'cancelled' });
    }
    const replacement = changed.find((r: any) => String(r.task_id) === ids[1] && r.status === 'pending');
    expect(replacement).toBeDefined();
    // Acknowledgement runs on the same protected transaction.
    await repository.acknowledgeReminder(connection as any, String(replacement.id), 'WEB', null);
    expect((await alerts()).find((r: any) => r.id === replacement.id)).toMatchObject({ status: 'acknowledged', delivery_status: 'acknowledged' });

    // An owner with only deleted tasks must still be visited to cancel old
    // alerts. The task-only candidate query used to omit this owner entirely.
    await sql('UPDATE personal_tasks SET deleted_at=? WHERE user_id=?', [now, owner]);
    await repository.sweepTaskAlerts(new Date(now.getTime() + 180000));
    const remaining = (await alerts()).filter((r: any) => r.status === 'pending');
    expect(remaining).toEqual([]);
  });
});
