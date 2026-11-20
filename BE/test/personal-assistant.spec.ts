import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createConnection, Connection } from 'mysql2/promise';
import { AddressInfo } from 'node:net';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PersonalAssistantController } from '../src/modules/personal-assistant/personal-assistant.controller';
import { PersonalAssistantService } from '../src/modules/personal-assistant/personal-assistant.service';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';
import { MYSQL_POOL } from '../src/database/database.constants';

const {
  APPROVED_PA_TABLES,
  migratePersonalAssistant,
} = require('../src/database/migrations/20261114_personal_assistant.cjs');
const {
  migratePa10Subtasks,
} = require('../src/database/migrations/20261115_pa10_subtasks.cjs');

const mysqlSuite = process.env.PA_CRUD_TEST_DATABASE ? describe : describe.skip;

mysqlSuite('Personal Assistant real-MySQL CRUD, task priority, progress and ownership', () => {
  let conn: Connection;
  let dbName: string;
  let app: INestApplication;
  let baseUrl: string;
  let currentUserId = '101';
  let currentUserRole: 'USER' | 'ADMIN' = 'USER';

  beforeAll(async () => {
    const database = process.env.PA_CRUD_TEST_DATABASE;
    if (!database || !/^aiva_pa_test_[a-z0-9_]+$/.test(database)) {
      throw new Error('PA_CRUD_TEST_DATABASE must identify a dedicated empty test database');
    }
    if (!process.env.PA_TEST_HOST || !process.env.PA_TEST_USER) {
      throw new Error('Explicit PA_TEST_HOST and PA_TEST_USER are required');
    }
    conn = await createConnection({
      host: process.env.PA_TEST_HOST,
      port: Number(process.env.PA_TEST_PORT || 3306),
      user: process.env.PA_TEST_USER,
      password: process.env.PA_TEST_PASSWORD || '',
      database,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });

    dbName = database;
    const [existingTables] = await conn.query<any[]>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    );
    if (existingTables.length) throw new Error('Refusing to use a nonempty CRUD test database');

    // Create minimal prerequisite parent tables (users, devices, conversations)
    await conn.query(`
      CREATE TABLE \`users\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`email\` VARCHAR(255) NOT NULL UNIQUE,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`display_name\` VARCHAR(150) NOT NULL,
        \`status\` VARCHAR(24) NOT NULL DEFAULT 'active',
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE \`devices\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`device_uid\` VARCHAR(128) NOT NULL UNIQUE,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE \`conversations\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` BIGINT NOT NULL,
        \`channel\` VARCHAR(20) NOT NULL DEFAULT 'WEB',
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'active',
        \`started_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(
      `INSERT INTO users (id, email, password_hash, display_name) VALUES (101, 'usera@example.invalid', 'hash', 'User A'), (202, 'userb@example.invalid', 'hash', 'User B')`
    );

    // Apply the 6-table Personal Assistant migration + PA-10 additive subtasks migration
    const statements = await migratePersonalAssistant(conn, { apply: true });
    expect(statements).toHaveLength(6);
    // Second run is idempotent
    expect(await migratePersonalAssistant(conn, { apply: true })).toEqual([]);

    const pa10Statements = await migratePa10Subtasks(conn, { apply: true });
    expect(pa10Statements).toHaveLength(3);
    expect(await migratePa10Subtasks(conn, { apply: true })).toEqual([]);

    await require('../src/database/migrations/20261120_pa_calendar_compat.cjs')
      .migratePaCalendarCompat(conn, { apply: true });

    const [tables] = await conn.query<any[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'personal_%' OR TABLE_NAME = 'reminder_deliveries') ORDER BY TABLE_NAME`
    );
    expect(tables.map((t) => t.name).sort()).toEqual([...APPROVED_PA_TABLES].sort());
    expect(tables.map((t) => t.name)).not.toContain('personal_plan_sessions');

    const poolAdapter = {
      execute: (sql: string, params?: any[]) => conn.execute(sql, params),
      query: (sql: string, params?: any[]) => conn.query(sql, params),
      getConnection: async () => ({
        execute: (sql: string, params?: any[]) => conn.execute(sql, params),
        query: (sql: string, params?: any[]) => conn.query(sql, params),
        beginTransaction: () => conn.beginTransaction(),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => {},
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PersonalAssistantController],
      providers: [
        PersonalAssistantRepository,
        PersonalAssistantService,
        Reflector,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: MYSQL_POOL, useValue: poolAdapter },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        id: currentUserId,
        email: `user${currentUserId}@example.invalid`,
        display_name: `User ${currentUserId}`,
        role: currentUserRole,
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (conn) {
      // Preserve the dedicated test database for inspection; never DROP a database.
      await conn.end();
    }
  });

  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    asUserId = '101',
    asRole: 'USER' | 'ADMIN' = 'USER'
  ) {
    currentUserId = asUserId;
    currentUserRole = asRole;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  let planId = '';
  let taskId = '';

  it('PA-12: creates a 10-session personal plan using personal_plans + personal_tasks (no 7th table) and tracks 3/10 (30%) progress', async () => {
    const created = await request('/user/plans', 'POST', {
      title: 'Kế hoạch luyện tập 10 buổi',
      description: 'Lộ trình 10 buổi theo chuẩn Nhóm II',
      total_sessions: 10,
    });
    expect(created.status).toBe(201);
    planId = created.body.id;
    expect(created.body.total_sessions).toBe(10);
    expect(created.body.completed_sessions).toBe(0);
    expect(created.body.remaining_sessions).toBe(10);
    expect(created.body.progress_percent).toBe(0);
    expect(created.body.sessions).toHaveLength(10);

    // Complete 3 sessions
    for (let i = 0; i < 3; i++) {
      const sessionId = created.body.sessions[i].id;
      const done = await request(`/user/plans/${planId}/sessions/${sessionId}/complete`, 'POST', {});
      expect(done.status).toBe(200);
    }

    // Mark session 4 partially in progress (60%): must NOT count as completed!
    const session4Id = created.body.sessions[3].id;
    const partialUpdate = await request(`/user/tasks/${session4Id}`, 'PATCH', {
      status: 'in_progress',
      progress_percent: 60,
    });
    expect(partialUpdate.status).toBe(200);
    expect(partialUpdate.body.status).toBe('in_progress');
    expect(partialUpdate.body.progress_percent).toBe(60);

    // Retrieve plan progress: must be 3/10 completed, 7 remaining, 30% progress
    const progress = await request(`/user/plans/${planId}`, 'GET');
    expect(progress.status).toBe(200);
    expect(progress.body.completed_sessions).toBe(3);
    expect(progress.body.remaining_sessions).toBe(7);
    expect(progress.body.progress_percent).toBe(30);

    // Duplicate completion on session 1 must NOT increment progress twice
    const dup = await request(
      `/user/plans/${planId}/sessions/${created.body.sessions[0].id}/complete`,
      'POST',
      {}
    );
    expect(dup.status).toBe(200);
    expect(dup.body.already_completed).toBe(true);
    expect(dup.body.completed_sessions).toBe(3);
    expect(dup.body.remaining_sessions).toBe(7);
    expect(dup.body.progress_percent).toBe(30);
  });

  it('PA-10 & PA-11: creates, retrieves, edits, updates priority without losing fields, detects conflicts, and enforces ownership', async () => {
    const createRes = await request('/user/tasks', 'POST', {
      title: 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.',
      description: 'Bản thảo chương 4 & 5',
      due_at: '2026-11-15T10:00:00.000Z',
      priority: 'MEDIUM',
    });
    expect(createRes.status).toBe(201);
    taskId = createRes.body.id;
    expect(createRes.body.title).toBe('Hoàn thành báo cáo đồ án trước 17:00 ngày mai.');
    expect(createRes.body.priority).toBe('MEDIUM');

    // Retrieve saved task
    const detail = await request(`/user/tasks/${taskId}`, 'GET');
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe('Bản thảo chương 4 & 5');

    // Edit task
    const edited = await request(`/user/tasks/${taskId}`, 'PATCH', {
      description: 'Bản thảo chương 4, 5 và slide bảo vệ',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.description).toBe('Bản thảo chương 4, 5 và slide bảo vệ');

    // PA-11: Update priority to HIGH and verify unrelated fields are preserved
    const prioRes = await request(`/user/tasks/${taskId}/priority`, 'PATCH', {
      priority: 'HIGH',
      expected_updated_at: edited.body.updated_at,
    });
    expect(prioRes.status).toBe(200);
    expect(prioRes.body.priority).toBe('HIGH');
    expect(prioRes.body.title).toBe('Hoàn thành báo cáo đồ án trước 17:00 ngày mai.');
    expect(prioRes.body.description).toBe('Bản thảo chương 4, 5 và slide bảo vệ');
    expect(prioRes.body.due_at).toBe('2026-11-15T10:00:00.000Z');

    // PA-11: Invalid priority is rejected with 400
    const badPrio = await request(`/user/tasks/${taskId}/priority`, 'PATCH', {
      priority: 'URGENT_INVENTED',
    });
    expect(badPrio.status).toBe(400);

    // PA-11: Stale expected_updated_at is rejected with 409 Conflict
    const staleConflict = await request(`/user/tasks/${taskId}/priority`, 'PATCH', {
      priority: 'LOW',
      expected_updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(staleConflict.status).toBe(409);

    // Ownership enforcement: User B (202) cannot access or modify User A's task or plan
    expect((await request(`/user/tasks/${taskId}`, 'GET', undefined, '202')).status).toBe(403);
    expect(
      (await request(`/user/tasks/${taskId}/priority`, 'PATCH', { priority: 'LOW' }, '202')).status
    ).toBe(403);
    expect(
      (await request(`/user/tasks/${taskId}/complete`, 'POST', {}, '202')).status
    ).toBe(403);
    expect((await request(`/user/plans/${planId}`, 'GET', undefined, '202')).status).toBe(403);

    // Complete task and verify duplicate completion does not increment twice
    const complete1 = await request(`/user/tasks/${taskId}/complete`, 'POST', {});
    expect(complete1.status).toBe(200);
    expect(complete1.body.status).toBe('completed');
    expect(complete1.body.already_completed).toBe(false);

    const listAfter1 = await request('/user/tasks', 'GET');
    const completedCount1 = listAfter1.body.summary.completed_tasks;

    const complete2 = await request(`/user/tasks/${taskId}/complete`, 'POST', {});
    expect(complete2.status).toBe(200);
    expect(complete2.body.already_completed).toBe(true);

    const listAfter2 = await request('/user/tasks', 'GET');
    expect(listAfter2.body.summary.completed_tasks).toBe(completedCount1);
  });

  it('PA-10: detects ambiguous task references when multiple active tasks match a keyword', async () => {
    await request('/user/tasks', 'POST', { title: 'Báo cáo tuần 10 - Phần FE' });
    await request('/user/tasks', 'POST', { title: 'Báo cáo tuần 10 - Phần BE' });

    const ambiguous = await request('/user/tasks/resolve', 'POST', {
      reference: 'Báo cáo tuần 10',
    });
    expect(ambiguous.status).toBe(409);
  });

  it('PA Events (personal_events): CRUD, schedule overlap conflict detection, and cross-user isolation', async () => {
    currentUserId = '101';
    const ev1 = await request('/user/events', 'POST', {
      title: 'Họp nhóm đồ án AIVA-IoT',
      location: 'Phòng Lab B1',
      start_at: '2026-11-16T09:00:00Z',
      end_at: '2026-11-16T10:30:00Z',
    });
    expect(ev1.status).toBe(201);
    expect(ev1.body.title).toBe('Họp nhóm đồ án AIVA-IoT');
    expect(ev1.body.has_conflict).toBe(false);

    const linked = await request('/user/tasks', 'POST', { title: 'Prepare meeting', event_id: ev1.body.id });
    expect(linked.status).toBe(201);
    expect(linked.body.event_id).toBe(ev1.body.id);
    const crossLink = await request('/user/tasks', 'POST', { title: 'Invalid link', event_id: ev1.body.id }, '202');
    expect(crossLink.status).toBe(403);
    expect((await request(`/user/tasks/${linked.body.id}`, 'PATCH', { event_id: null })).body.event_id).toBeNull();

    const ev2 = await request('/user/events', 'POST', {
      title: 'Báo cáo tiến độ với giảng viên',
      start_at: '2026-11-16T10:00:00Z',
      end_at: '2026-11-16T11:00:00Z',
    });
    expect(ev2.status).toBe(201);
    expect(ev2.body.has_conflict).toBe(true);
    expect(ev2.body.conflicting_event_ids).toContain(ev1.body.id);

    // Invalid end_at < start_at rejected with 400
    const badEv = await request('/user/events', 'POST', {
      title: 'Sự kiện lỗi thời gian',
      start_at: '2026-11-16T12:00:00Z',
      end_at: '2026-11-16T11:00:00Z',
    });
    expect(badEv.status).toBe(400);

    // Cross-user isolation
    const forbidden = await request(`/user/events/${ev1.body.id}`, 'GET', undefined, '202');
    expect(forbidden.status).toBe(403);

    // Update status to completed clears active conflict
    const updated = await request(`/user/events/${ev1.body.id}`, 'PATCH', {
      status: 'completed',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('completed');

    const del = await request(`/user/events/${ev2.body.id}`, 'DELETE');
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
  });

  it('PA Reminders & Deliveries (personal_reminders, reminder_deliveries): CRUD, acknowledgment, and delivery tracking', async () => {
    currentUserId = '101';
    const taskRes = await request('/user/tasks', 'POST', {
      title: 'Gửi slide thuyết trình',
      priority: 'HIGH',
    });
    expect(taskRes.status).toBe(201);

    const rem = await request('/user/reminders', 'POST', {
      message: 'Nhắc gửi slide trước 16:00',
      remind_at: '2026-11-16T15:30:00Z',
      channel: 'WEB',
      task_id: taskRes.body.id,
    });
    expect(rem.status).toBe(201);
    expect(rem.body.status).toBe('pending');
    expect(rem.body.task_id).toBe(taskRes.body.id);
    expect(Array.isArray(rem.body.deliveries)).toBe(true);
    expect(rem.body.deliveries).toHaveLength(1);
    expect(rem.body.deliveries[0].status).toBe('pending');

    // Manual acknowledgment.
    const ack = await request(`/user/reminders/${rem.body.id}/acknowledge`, 'POST', {});
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('acknowledged');
    expect(ack.body.deliveries[0].status).toBe('acknowledged');
    expect(ack.body.deliveries[0].acknowledged_at).toBeTruthy();

    // Cross-user isolation
    const forbidden = await request(`/user/reminders/${rem.body.id}`, 'DELETE', undefined, '202');
    expect(forbidden.status).toBe(403);

    const del = await request(`/user/reminders/${rem.body.id}`, 'DELETE');
    expect(del.status).toBe(200);
  });

  it('PA Memories (personal_memories): upsert by memory_key, update, search, and isolation', async () => {
    currentUserId = '101';
    expect((await request('/user/memories', 'POST', { memory_key: 'no_consent', memory_value: 'private' })).status).toBe(400);
    expect((await request('/user/memories', 'POST', { memory_key: 'no_consent', memory_value: 'private', consent: false })).status).toBe(400);
    expect((await request('/user/memories', 'POST', { memory_key: 'no_consent', memory_value: 'private', consent: 'false' })).status).toBe(400);
    expect((await request('/user/memories?search=no_consent')).body.total).toBe(0);
    const mem1 = await request('/user/memories', 'POST', {
      consent: true,
      memory_key: 'preferred_study_time',
      memory_value: '20:00 - 22:30 mỗi tối',
      category: 'habit',
      confidence: 0.95,
    });
    expect(mem1.status).toBe(201);
    expect(mem1.body.memory_key).toBe('preferred_study_time');
    expect(mem1.body.confidence).toBe(0.95);

    // Upserting same memory_key updates value without creating duplicate row
    const memUpsert = await request('/user/memories', 'POST', {
      consent: true,
      memory_key: 'preferred_study_time',
      memory_value: '21:00 - 23:00 mỗi tối',
      category: 'habit',
      confidence: 0.98,
    });
    expect(memUpsert.status).toBe(201);
    expect(memUpsert.body.id).toBe(mem1.body.id);
    expect(memUpsert.body.memory_value).toBe('21:00 - 23:00 mỗi tối');
    expect((await request(`/user/memories/${mem1.body.id}`, 'PATCH', { memory_value: 'No consent' })).status).toBe(400);
    expect((await request(`/user/memories/${mem1.body.id}`)).body.memory_value).toBe('21:00 - 23:00 mỗi tối');

    const list = await request('/user/memories?category=habit');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    // Cross-user isolation
    const forbidden = await request(`/user/memories/${mem1.body.id}`, 'PATCH', {
      consent: true,
      memory_value: 'Hack',
    }, '202');
    expect(forbidden.status).toBe(403);

    const del = await request(`/user/memories/${mem1.body.id}`, 'DELETE');
    expect(del.status).toBe(200);
  });

  it('rejects impossible plan dates and changes to completed task progress', async () => {
    expect((await request('/user/plans', 'POST', { title: 'Invalid date', total_sessions: 1, start_date: '2026-02-30' })).status).toBe(400);
    const task = await request('/user/tasks', 'POST', { title: 'Completed progress' });
    await request(`/user/tasks/${task.body.id}/complete`, 'POST', {});
    expect((await request(`/user/tasks/${task.body.id}`, 'PATCH', { progress_percent: 60 })).status).toBe(409);
    const saved = await request(`/user/tasks/${task.body.id}`);
    expect(saved.body.status).toBe('completed');
    expect(saved.body.progress_percent).toBe(100);
  });

  it('PA-10: manages subtasks hierarchy, prevents cycles and cross-user access, preserves children on parent soft-delete', async () => {
    const parent = await request('/user/tasks', 'POST', { title: 'Task cha PA-10' });
    expect(parent.status).toBe(201);

    const child = await request('/user/tasks', 'POST', {
      title: 'Task con 1',
      parent_task_id: parent.body.id,
    });
    expect(child.status).toBe(201);
    expect(child.body.parent_task_id).toBe(parent.body.id);
    expect(child.body.parent_task_title).toBe('Task cha PA-10');

    const grandChild = await request('/user/tasks', 'POST', {
      title: 'Task cháu',
      parent_task_id: child.body.id,
    });
    expect(grandChild.status).toBe(201);

    // Prevent self-parenting and cycle (parent -> grandChild -> child -> parent)
    expect(
      (await request(`/user/tasks/${parent.body.id}`, 'PATCH', { parent_task_id: parent.body.id })).status
    ).toBe(400);
    expect(
      (await request(`/user/tasks/${parent.body.id}`, 'PATCH', { parent_task_id: grandChild.body.id })).status
    ).toBe(400);

    // Prevent cross-user subtask attachment or non-existent parent
    expect(
      (await request('/user/tasks', 'POST', { title: 'Cross user child', parent_task_id: parent.body.id }, '202')).status
    ).toBe(403);
    expect(
      (await request('/user/tasks', 'POST', { title: 'Missing parent child', parent_task_id: '999999' })).status
    ).toBe(404);

    // Detail and filtered list expose subtasks without modifying parent progress
    const detail = await request(`/user/tasks/${parent.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.subtask_count).toBe(1);
    expect(detail.body.subtasks).toHaveLength(1);
    expect(detail.body.subtasks[0].id).toBe(child.body.id);

    const filteredChildren = await request(`/user/tasks?parent_task_id=${parent.body.id}`);
    expect(filteredChildren.status).toBe(200);
    expect(filteredChildren.body.items.map((t: any) => t.id)).toEqual([child.body.id]);

    // Soft-deleting parent must NOT delete child; child stays active and detached cleanly
    const delParent = await request(`/user/tasks/${parent.body.id}`, 'DELETE');
    expect(delParent.status).toBe(200);
    expect((await request(`/user/tasks/${parent.body.id}`)).status).toBe(404);

    const childAfter = await request(`/user/tasks/${child.body.id}`);
    expect(childAfter.status).toBe(200);
    expect(childAfter.body.parent_task_id).toBeNull();

    // Cannot attach new subtask to soft-deleted parent
    expect(
      (await request('/user/tasks', 'POST', { title: 'Deleted parent child', parent_task_id: parent.body.id })).status
    ).toBe(404);
  });

  it('PA-10: complete -> reopen -> complete syncs completed_at, progress_percent, plan status, pagination, filters, and USER role RBAC', async () => {
    // Role guard: ADMIN rejected 403 on /user/tasks*
    expect((await request('/user/tasks', 'GET', undefined, '101', 'ADMIN')).status).toBe(403);
    expect((await request('/user/tasks', 'POST', { title: 'Admin denied' }, '101', 'ADMIN')).status).toBe(403);

    // Plan with 1 session to verify plan completion -> reopen -> completion sync
    const singlePlan = await request('/user/plans', 'POST', {
      title: 'Kế hoạch 1 buổi PA-10 reopen',
      total_sessions: 1,
    });
    expect(singlePlan.status).toBe(201);
    const sessionTaskId = singlePlan.body.sessions[0].id;

    // Complete -> plan becomes completed
    const c1 = await request(`/user/tasks/${sessionTaskId}/complete`, 'POST', {});
    expect(c1.status).toBe(200);
    expect(c1.body.status).toBe('completed');
    expect(c1.body.progress_percent).toBe(100);
    expect(c1.body.completed_at).toBeTruthy();
    expect((await request(`/user/plans/${singlePlan.body.id}`)).body.status).toBe('completed');

    // Reopen to pending -> completed_at NULL, progress_percent 0, plan back to active
    const r1 = await request(`/user/tasks/${sessionTaskId}/reopen`, 'POST', {
      expected_updated_at: c1.body.updated_at,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('pending');
    expect(r1.body.progress_percent).toBe(0);
    expect(r1.body.completed_at).toBeNull();
    expect(r1.body.already_reopened).toBe(false);
    expect((await request(`/user/plans/${singlePlan.body.id}`)).body.status).toBe('active');

    // Duplicate reopen is idempotent
    const r2 = await request(`/user/tasks/${sessionTaskId}/reopen`, 'POST', {});
    expect(r2.status).toBe(200);
    expect(r2.body.already_reopened).toBe(true);
    expect(r2.body.completed_at).toBeNull();

    // Complete again -> Reopen to in_progress (45%) -> Complete again
    const c2 = await request(`/user/tasks/${sessionTaskId}/complete`, 'POST', {});
    expect(c2.status).toBe(200);
    expect(c2.body.already_completed).toBe(false);
    expect((await request(`/user/plans/${singlePlan.body.id}`)).body.status).toBe('completed');

    const r3 = await request(`/user/tasks/${sessionTaskId}/reopen`, 'POST', {
      status: 'in_progress',
      progress_percent: 45,
    });
    expect(r3.status).toBe(200);
    expect(r3.body.status).toBe('in_progress');
    expect(r3.body.progress_percent).toBe(45);
    expect(r3.body.completed_at).toBeNull();

    // Edit status to partial and filter by status=partial + pagination
    const partialEdit = await request(`/user/tasks/${sessionTaskId}`, 'PATCH', {
      status: 'partial',
      progress_percent: 70,
    });
    expect(partialEdit.status).toBe(200);
    expect(partialEdit.body.status).toBe('partial');

    const partialList = await request('/user/tasks?status=partial&page=1&limit=5');
    expect(partialList.status).toBe(200);
    expect(partialList.body.items.some((t: any) => t.id === sessionTaskId)).toBe(true);
    expect(partialList.body.page).toBe(1);
    expect(partialList.body.limit).toBe(5);
    expect(partialList.body.total_pages).toBeGreaterThanOrEqual(1);

    // Re-complete from partial -> completes cleanly
    const c3 = await request(`/user/tasks/${sessionTaskId}/complete`, 'POST', {});
    expect(c3.status).toBe(200);
    expect(c3.body.status).toBe('completed');
    expect(c3.body.progress_percent).toBe(100);

    // Cancelled task cannot be reopened
    const cancelTarget = await request('/user/tasks', 'POST', { title: 'Cancel reopen guard' });
    await request(`/user/tasks/${cancelTarget.body.id}/cancel`, 'POST', { reason: 'Not needed' });
    expect((await request(`/user/tasks/${cancelTarget.body.id}/reopen`, 'POST', {})).status).toBe(409);
  });

  it('PA-11: supports priority filtering, sort_by (priority_desc/priority_asc), independent parent/child updates, and USER-only RBAC', async () => {
    currentUserRole = 'USER';
    currentUserId = '101';

    const sortTag = `PA11_${Date.now()}`;
    const lowTask = await request('/user/tasks', 'POST', {
      title: `${sortTag} Low task`,
      priority: 'LOW',
    });
    const highTask = await request('/user/tasks', 'POST', {
      title: `${sortTag} High task`,
      priority: 'HIGH',
    });
    const mediumTask = await request('/user/tasks', 'POST', {
      title: `${sortTag} Medium task`,
      priority: 'MEDIUM',
    });
    expect(lowTask.status).toBe(201);
    expect(highTask.status).toBe(201);
    expect(mediumTask.status).toBe(201);

    // Filter by priority=HIGH with search
    const filteredHigh = await request(`/user/tasks?search=${sortTag}&priority=HIGH`);
    expect(filteredHigh.status).toBe(200);
    expect(filteredHigh.body.items.map((t: any) => t.id)).toEqual([highTask.body.id]);

    // Sort priority_desc (HIGH -> MEDIUM -> LOW)
    const sortedDesc = await request(`/user/tasks?search=${sortTag}&sort_by=priority_desc`);
    expect(sortedDesc.status).toBe(200);
    expect(sortedDesc.body.items.map((t: any) => t.priority)).toEqual(['HIGH', 'MEDIUM', 'LOW']);

    // Sort priority_asc (LOW -> MEDIUM -> HIGH)
    const sortedAsc = await request(`/user/tasks?search=${sortTag}&sort_by=priority_asc`);
    expect(sortedAsc.status).toBe(200);
    expect(sortedAsc.body.items.map((t: any) => t.priority)).toEqual(['LOW', 'MEDIUM', 'HIGH']);

    // Reject invalid sort_by & invalid priority
    expect((await request('/user/tasks?sort_by=invalid_sort')).status).toBe(400);
    expect(
      (await request(`/user/tasks/${lowTask.body.id}/priority`, 'PATCH', { priority: 'URGENT' })).status
    ).toBe(400);

    // Parent and child priority updates stay independent & preserve parent_task_id
    const childTask = await request('/user/tasks', 'POST', {
      title: `${sortTag} Child task`,
      parent_task_id: highTask.body.id,
      priority: 'LOW',
    });
    expect(childTask.status).toBe(201);

    const updatedChild = await request(`/user/tasks/${childTask.body.id}/priority`, 'PATCH', {
      priority: 'MEDIUM',
      expected_updated_at: childTask.body.updated_at,
    });
    expect(updatedChild.status).toBe(200);
    expect(updatedChild.body.priority).toBe('MEDIUM');
    expect(updatedChild.body.parent_task_id).toBe(highTask.body.id);

    // Parent remains HIGH
    const parentAfterChildUpdate = await request(`/user/tasks/${highTask.body.id}`);
    expect(parentAfterChildUpdate.status).toBe(200);
    expect(parentAfterChildUpdate.body.priority).toBe('HIGH');

    // Update parent priority to LOW -> child remains MEDIUM and linked
    const updatedParent = await request(`/user/tasks/${highTask.body.id}/priority`, 'PATCH', {
      priority: 'LOW',
      expected_updated_at: parentAfterChildUpdate.body.updated_at,
    });
    expect(updatedParent.status).toBe(200);
    expect(updatedParent.body.priority).toBe('LOW');

    const childAfterParentUpdate = await request(`/user/tasks/${childTask.body.id}`);
    expect(childAfterParentUpdate.status).toBe(200);
    expect(childAfterParentUpdate.body.priority).toBe('MEDIUM');
    expect(childAfterParentUpdate.body.parent_task_id).toBe(highTask.body.id);

    // Stale expected_updated_at rejected with 409
    const staleUpdate = await request(`/user/tasks/${highTask.body.id}/priority`, 'PATCH', {
      priority: 'HIGH',
      expected_updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(staleUpdate.status).toBe(409);

    // Ownership isolation: User 202 cannot change priority of User 101's task
    const crossUserPatch = await request(
      `/user/tasks/${childTask.body.id}/priority`,
      'PATCH',
      { priority: 'HIGH' },
      '202'
    );
    expect(crossUserPatch.status).toBe(403);

    // ADMIN role rejected with 403 on priority endpoint
    const adminPatch = await request(
      `/user/tasks/${childTask.body.id}/priority`,
      'PATCH',
      { priority: 'HIGH' },
      '101',
      'ADMIN'
    );
    expect(adminPatch.status).toBe(403);
  });

  it('PA-12: tracks task progress, preserves status/progress_percent/completed_at consistency, isolates parent vs child progress, and enforces USER RBAC on /user/plans*', async () => {
    // /user/plans* must reject ADMIN with 403
    expect((await request('/user/plans', 'GET', undefined, '101', 'ADMIN')).status).toBe(403);
    expect(
      (
        await request(
          '/user/plans',
          'POST',
          { title: 'Admin denied plan', total_sessions: 1 },
          '101',
          'ADMIN'
        )
      ).status
    ).toBe(403);
    expect((await request(`/user/plans/${planId}`, 'GET', undefined, '101', 'ADMIN')).status).toBe(
      403
    );
    expect(
      (
        await request(
          `/user/plans/${planId}/sessions/1/complete`,
          'POST',
          {},
          '101',
          'ADMIN'
        )
      ).status
    ).toBe(403);

    // Consistency between status, progress_percent, completed_at, and no auto-completion via progress_percent=100
    const parent = await request('/user/tasks', 'POST', { title: 'Task cha PA-12 progress' });
    expect(parent.status).toBe(201);
    expect(parent.body.status).toBe('pending');
    expect(parent.body.progress_percent).toBe(0);
    expect(parent.body.completed_at).toBeNull();

    // Updating progress_percent > 0 automatically transitions pending -> in_progress, leaving completed_at null
    const parentProg40 = await request(`/user/tasks/${parent.body.id}`, 'PATCH', {
      progress_percent: 40,
    });
    expect(parentProg40.status).toBe(200);
    expect(parentProg40.body.status).toBe('in_progress');
    expect(parentProg40.body.progress_percent).toBe(40);
    expect(parentProg40.body.completed_at).toBeNull();

    // Updating status to partial with 85% keeps completed_at null
    const parentPartial = await request(`/user/tasks/${parent.body.id}`, 'PATCH', {
      status: 'partial',
      progress_percent: 85,
    });
    expect(parentPartial.status).toBe(200);
    expect(parentPartial.body.status).toBe('partial');
    expect(parentPartial.body.progress_percent).toBe(85);
    expect(parentPartial.body.completed_at).toBeNull();

    // progress_percent=100 is rejected on PATCH /user/tasks/:id (must confirm completion explicitly)
    expect(
      (await request(`/user/tasks/${parent.body.id}`, 'PATCH', { progress_percent: 100 })).status
    ).toBe(400);

    // Child task progress and explicit completion do NOT auto-mutate parent task status/progress
    const child = await request('/user/tasks', 'POST', {
      title: 'Task con PA-12 independent',
      parent_task_id: parent.body.id,
    });
    expect(child.status).toBe(201);

    const childCompleted = await request(`/user/tasks/${child.body.id}/complete`, 'POST', {});
    expect(childCompleted.status).toBe(200);
    expect(childCompleted.body.status).toBe('completed');
    expect(childCompleted.body.progress_percent).toBe(100);
    expect(childCompleted.body.completed_at).not.toBeNull();

    const parentAfterChildComplete = await request(`/user/tasks/${parent.body.id}`);
    expect(parentAfterChildComplete.status).toBe(200);
    expect(parentAfterChildComplete.body.status).toBe('partial');
    expect(parentAfterChildComplete.body.progress_percent).toBe(85);
    expect(parentAfterChildComplete.body.completed_at).toBeNull();
  });

  it('PA-12: computes parent aggregated_progress_percent from active subtasks (mean, excluding cancelled/deleted, 100% does not auto-complete, fallback when none)', async () => {
    // 1. Parent with no children -> aggregated_progress_percent = null, effective = own progress (25)
    const parent = await request('/user/tasks', 'POST', { title: 'Parent Rollup PA-12' });
    expect(parent.status).toBe(201);
    const parentOwn = await request(`/user/tasks/${parent.body.id}`, 'PATCH', {
      status: 'in_progress',
      progress_percent: 25,
    });
    expect(parentOwn.status).toBe(200);
    expect(parentOwn.body.aggregated_progress_percent).toBeNull();
    expect(parentOwn.body.effective_progress_percent).toBe(25);
    expect(parentOwn.body.active_subtask_count).toBe(0);

    // 2. Add 3 subtasks: c1=20, c2=70, c3=90 -> mean = (20+70+90)/3 = 60
    const c1 = await request('/user/tasks', 'POST', { title: 'Sub 1', parent_task_id: parent.body.id });
    const c2 = await request('/user/tasks', 'POST', { title: 'Sub 2', parent_task_id: parent.body.id });
    const c3 = await request('/user/tasks', 'POST', { title: 'Sub 3', parent_task_id: parent.body.id });
    await request(`/user/tasks/${c1.body.id}`, 'PATCH', { progress_percent: 20 });
    await request(`/user/tasks/${c2.body.id}`, 'PATCH', { progress_percent: 70 });
    await request(`/user/tasks/${c3.body.id}`, 'PATCH', { progress_percent: 90 });

    const pMean = await request(`/user/tasks/${parent.body.id}`);
    expect(pMean.status).toBe(200);
    expect(pMean.body.aggregated_progress_percent).toBe(60);
    expect(pMean.body.effective_progress_percent).toBe(60);
    expect(pMean.body.active_subtask_count).toBe(3);
    expect(pMean.body.progress_percent).toBe(25); // own stored progress untouched

    // 3. Cancel c3 (was 90%) -> excluded; remaining c1=20, c2=70 -> mean = 45
    await request(`/user/tasks/${c3.body.id}/cancel`, 'POST', { reason: 'No longer needed' });
    const pAfterCancel = await request(`/user/tasks/${parent.body.id}`);
    expect(pAfterCancel.body.aggregated_progress_percent).toBe(45);
    expect(pAfterCancel.body.active_subtask_count).toBe(2);

    // 4. Complete c1 and c2 (both 100%) -> aggregated=100%, parent stays in_progress & stored progress=25 & completed_at=null
    await request(`/user/tasks/${c1.body.id}/complete`, 'POST', {});
    await request(`/user/tasks/${c2.body.id}/complete`, 'POST', {});
    const pAllDone = await request(`/user/tasks/${parent.body.id}`);
    expect(pAllDone.body.aggregated_progress_percent).toBe(100);
    expect(pAllDone.body.effective_progress_percent).toBe(100);
    expect(pAllDone.body.status).toBe('in_progress');
    expect(pAllDone.body.progress_percent).toBe(25);
    expect(pAllDone.body.completed_at).toBeNull();

    // 5. Reopen c2 -> 30% => mean = (100+30)/2 = 65
    await request(`/user/tasks/${c2.body.id}/reopen`, 'POST', {
      status: 'in_progress',
      progress_percent: 30,
    });
    const pAfterReopen = await request(`/user/tasks/${parent.body.id}`);
    expect(pAfterReopen.body.aggregated_progress_percent).toBe(65);

    // 6. Soft-delete c1 -> only c2 (30%) active => aggregated=30; soft-delete c2 -> no eligible subtasks => null & fallback to own 25%
    await request(`/user/tasks/${c1.body.id}`, 'DELETE');
    const pAfterDel1 = await request(`/user/tasks/${parent.body.id}`);
    expect(pAfterDel1.body.aggregated_progress_percent).toBe(30);
    expect(pAfterDel1.body.active_subtask_count).toBe(1);

    await request(`/user/tasks/${c2.body.id}`, 'DELETE');
    const pNoActiveChildren = await request(`/user/tasks/${parent.body.id}`);
    expect(pNoActiveChildren.body.aggregated_progress_percent).toBeNull();
    expect(pNoActiveChildren.body.effective_progress_percent).toBe(25);
    expect(pNoActiveChildren.body.active_subtask_count).toBe(0);
  });

});
