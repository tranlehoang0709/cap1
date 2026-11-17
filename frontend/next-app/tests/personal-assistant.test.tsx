import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveOperation } from '../src/lib/operations';
import { validateBody } from '../src/lib/validation';
import {
  ALLOWED_TASK_SORT_MODES,
  buildPriorityUpdatePayload,
  computeTaskProgressSummary,
  DEFAULT_TASK_PRIORITIES,
  extractAvailablePriorities,
  formatPlanProgressSummary,
  getDisplayTaskProgress,
  isSessionCompleted,
  isSessionPartial,
  organizeTasksForDisplay,
  parsePersonalPlan,
  parsePersonalPlans,
  parsePersonalTasks,
  parseTaskListMeta,
} from '../src/lib/personal-assistant';
import { PersonalAssistantWorkspaceView } from '../src/components/user/PersonalAssistantTasks';

test('PA BFF preserves consent, partial progress and session schedules', () => {
  assert.throws(() => validateBody('personalMemoryCreate', { memory_key: 'habit', memory_value: 'Study' }));
  assert.throws(() => validateBody('personalMemoryUpdate', { memory_value: 'Study', consent: false }));
  assert.equal(validateBody('personalMemoryCreate', { memory_key: 'habit', memory_value: 'Study', consent: true }).consent, true);
  assert.equal(validateBody('personalTaskUpdate', { progress_percent: 60 }).progress_percent, 60);
  assert.throws(() => validateBody('personalTaskUpdate', { progress_percent: 100 }));
  assert.equal(validateBody('personalTaskUpdate', { event_id: null }).event_id, null);
  const sessions = [{ title: 'Session 1', due_at: '2026-11-16T09:00:00Z' }];
  assert.deepEqual(validateBody('personalPlanCreate', { title: 'Plan', goal: 'Study', confirmed: true, total_sessions: 1, sessions }).sessions, sessions);
});

test('PA-10/11/12 BFF operations resolve for USER and validate numeric path parameters', () => {
  assert.equal(resolveOperation('personalTasks', 'USER').path, '/user/tasks');
  assert.equal(
    resolveOperation('personalTaskDetail', 'USER', { id: '42' }).path,
    '/user/tasks/42'
  );
  assert.equal(
    resolveOperation('personalTaskPriority', 'USER', { id: '42' }).path,
    '/user/tasks/42/priority'
  );
  assert.equal(
    resolveOperation('personalPlanSessionComplete', 'USER', { id: '7', sessionId: '3' }).path,
    '/user/plans/7/sessions/3/complete'
  );

  for (const invalidId of ['0', '../admin', 'abc', '-5']) {
    assert.throws(
      () => resolveOperation('personalTaskDetail', 'USER', { id: invalidId }),
      /INVALID_PARAMETER/
    );
    assert.throws(
      () =>
        resolveOperation('personalPlanSessionComplete', 'USER', {
          id: '7',
          sessionId: invalidId,
        }),
      /INVALID_PARAMETER/
    );
  }
});

test('PA-10 task creation and update validate Vietnamese task payload before sending to Backend', () => {
  const validTask = validateBody('personalTaskCreate', {
    title: 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.',
    description: 'Nộp bản PDF và slide thuyết trình.',
    due_at: '2026-11-15T17:00:00.000Z',
    plan_id: '10',
    session_number: 3,
  });
  assert.equal(validTask.title, 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.');
  assert.equal(validTask.plan_id, '10');
  assert.equal(validTask.session_number, 3);

  assert.throws(() => validateBody('personalTaskCreate', { title: '   ' }));
  assert.throws(() =>
    validateBody('personalTaskCreate', {
      title: 'Hoàn thành báo cáo đồ án',
      due_at: 'not-a-date',
    })
  );
  assert.throws(() =>
    validateBody('personalTaskCreate', {
      title: 'Hoàn thành báo cáo đồ án',
      plan_id: 'invalid-id',
    })
  );
});

test('PA-11 preserves Backend priority order, preserves task fields on priority change, and rejects invalid priority', () => {
  const backendPayload = {
    items: [
      {
        id: '101',
        title: 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.',
        description: 'Chương 4 & 5',
        status: 'pending',
        priority: 'P1',
        due_at: '2026-11-15T10:00:00.000Z',
        plan_id: '5',
        plan_title: 'Đồ án tốt nghiệp AIVA',
        session_number: 3,
        updated_at: '2026-11-14T12:00:00.000Z',
      },
      {
        id: '102',
        title: 'Kiểm thử phần cứng robot',
        status: 'in_progress',
        priority: 'P2',
        updated_at: '2026-11-14T12:05:00.000Z',
      },
    ],
    total: 2,
    allowed_priorities: ['P1', 'P2', 'P3'],
  };

  const tasks = parsePersonalTasks(backendPayload);
  // Exact Backend order preserved
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['101', '102']
  );

  const priorities = extractAvailablePriorities(backendPayload, tasks);
  assert.deepEqual(priorities, ['P1', 'P2', 'P3']);

  const updateBody = buildPriorityUpdatePayload(tasks[0], 'P2', priorities);
  assert.equal(updateBody.priority, 'P2');
  assert.equal(updateBody.title, 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.');
  assert.equal(updateBody.description, 'Chương 4 & 5');
  assert.equal(updateBody.due_at, '2026-11-15T10:00:00.000Z');
  assert.equal(updateBody.plan_id, '5');
  assert.equal(updateBody.session_number, 3);
  assert.equal(updateBody.expected_updated_at, '2026-11-14T12:00:00.000Z');

  // Reject unconfirmed/invented priority level
  assert.throws(
    () => buildPriorityUpdatePayload(tasks[0], 'INVENTED_URGENT', priorities),
    /không hợp lệ/
  );
  assert.throws(() => buildPriorityUpdatePayload(tasks[0], '   ', priorities));
});

test('PA-12 calculates multi-session progress from authoritative Backend data and never marks partial sessions completed', () => {
  const planResponse = {
    items: [
      {
        id: '5',
        title: 'Kế hoạch luyện tập & hoàn thiện đồ án 10 buổi',
        status: 'active',
        total_sessions: 10,
        completed_sessions: 3,
        remaining_sessions: 7,
        progress_percent: 30,
        sessions: [
          { id: '1', session_number: 1, title: 'Buổi 1', status: 'completed' },
          { id: '2', session_number: 2, title: 'Buổi 2', status: 'completed' },
          { id: '3', session_number: 3, title: 'Buổi 3', status: 'completed' },
          {
            id: '4',
            session_number: 4,
            title: 'Buổi 4 (đang làm dở 80%)',
            status: 'in_progress',
            progress_percent: 80,
          },
          {
            id: '5',
            session_number: 5,
            title: 'Buổi 5 (một phần)',
            status: 'partial',
            progress_percent: 50,
          },
        ],
      },
    ],
    total: 1,
  };

  const plans = parsePersonalPlans(planResponse);
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.equal(plan.completed_sessions, 3);
  assert.equal(plan.total_sessions, 10);
  assert.equal(plan.remaining_sessions, 7);
  assert.equal(plan.progress_percent, 30);

  const formatted = formatPlanProgressSummary(plan);
  assert.equal(formatted.completedText, 'Completed: 3/10 sessions.');
  assert.equal(formatted.progressText, 'Progress: 30%.');
  assert.equal(formatted.remainingText, 'Remaining: 7 sessions.');

  // Verify partial / in_progress sessions are NEVER marked completed
  const session4 = plan.sessions[3];
  const session5 = plan.sessions[4];
  assert.equal(session4.is_completed, false);
  assert.equal(session4.is_partial, true);
  assert.equal(session5.is_completed, false);
  assert.equal(session5.is_partial, true);
  assert.equal(
    isSessionCompleted({ status: 'in_progress', progress_percent: 99 }),
    false
  );
  assert.equal(isSessionPartial({ status: 'in_progress', progress_percent: 99 }), true);
});

test('PA-10/11/12 workspace component renders tasks, priority badges, plan association, and 3/10 session progress', () => {
  const tasksData = {
    items: [
      {
        id: '101',
        title: 'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.',
        description: 'Gửi giảng viên hướng dẫn duyệt',
        status: 'pending',
        priority: 'HIGH',
        due_at: '2026-11-15T10:00:00.000Z',
        plan_id: '5',
        plan_title: 'Lộ trình đồ án 10 buổi',
        session_number: 4,
      },
      {
        id: '102',
        title: 'Tổng hợp tài liệu tham khảo',
        status: 'completed',
        priority: 'MEDIUM',
      },
    ],
    total: 2,
    allowed_priorities: ['HIGH', 'MEDIUM', 'LOW'],
  };

  const plansData = {
    items: [
      {
        id: '5',
        title: 'Lộ trình đồ án 10 buổi',
        status: 'active',
        total_sessions: 10,
        completed_sessions: 3,
        remaining_sessions: 7,
        progress_percent: 30,
        sessions: [
          { id: '1', session_number: 1, title: 'Đề cương', status: 'completed' },
          { id: '2', session_number: 2, title: 'Thiết kế hệ thống', status: 'completed' },
          { id: '3', session_number: 3, title: 'Triển khai thực nghiệm', status: 'completed' },
          { id: '4', session_number: 4, title: 'Viết báo cáo', status: 'in_progress' },
        ],
      },
    ],
    total: 1,
  };

  const summary = computeTaskProgressSummary(tasksData, parsePersonalTasks(tasksData));
  assert.equal(summary.completed_tasks, 1);
  assert.equal(summary.pending_tasks, 1);
  assert.equal(summary.completion_percent, 50);

  const html = renderToStaticMarkup(
    <PersonalAssistantWorkspaceView
      tasksState={{ data: tasksData, loading: false, reload: () => {} }}
      plansState={{ data: plansData, loading: false, reload: () => {} }}
    />
  );

  assert.ok(html.includes('Hoàn thành báo cáo đồ án trước 17:00 ngày mai.'));
  assert.ok(html.includes('Lộ trình đồ án 10 buổi'));
  assert.ok(html.includes('HIGH'));
  assert.ok(html.includes('Completed: 3/10 sessions.'));
  assert.ok(html.includes('Progress: 30%.'));
  assert.ok(html.includes('Remaining: 7 sessions.'));
  assert.ok(html.includes('Chưa hoàn tất toàn bộ buổi (không tự động tính hoàn thành)'));
});

test('PA-10 BFF & UI cover subtasks hierarchy, reopen, ADMIN role rejection, partial filter, event link, and pagination', () => {
  // BFF role + route + validation checks
  assert.equal(resolveOperation('personalTaskReopen', 'USER', { id: '42' }).path, '/user/tasks/42/reopen');
  assert.throws(() => resolveOperation('personalTasks', 'ADMIN'), /FORBIDDEN/);
  assert.throws(() => resolveOperation('personalTaskReopen', 'ADMIN', { id: '42' }), /FORBIDDEN/);

  assert.equal(
    validateBody('personalTaskReopen', { status: 'in_progress', progress_percent: 40 }).progress_percent,
    40
  );
  assert.throws(() => validateBody('personalTaskReopen', { status: 'completed' as unknown as string }));
  assert.throws(() => validateBody('personalTaskReopen', { progress_percent: 100 }));

  const childPayload = validateBody('personalTaskCreate', {
    title: 'Việc con hợp lệ',
    parent_task_id: '10',
    event_id: '5',
  });
  assert.equal(childPayload.parent_task_id, '10');
  assert.equal(childPayload.event_id, '5');
  assert.equal(validateBody('personalTaskUpdate', { parent_task_id: null }).parent_task_id, null);
  assert.equal(validateBody('personalTaskUpdate', { status: 'partial', progress_percent: 55 }).status, 'partial');

  // Hierarchy ordering & pagination metadata
  const tasksData = {
    items: [
      {
        id: '10',
        title: 'Task cha gốc',
        status: 'in_progress',
        priority: 'HIGH',
        progress_percent: 60,
        subtask_count: 1,
        event_id: '5',
        event_title: 'Họp tuần 10',
      },
      {
        id: '11',
        title: 'Task đã xong để mở lại',
        status: 'completed',
        priority: 'MEDIUM',
        progress_percent: 100,
      },
      {
        id: '12',
        title: 'Task con trực thuộc 10',
        status: 'pending',
        priority: 'LOW',
        progress_percent: 15,
        parent_task_id: '10',
        parent_task_title: 'Task cha gốc',
      },
      {
        id: '13',
        title: 'Task con có cha ở trang khác',
        status: 'partial',
        priority: 'LOW',
        progress_percent: 50,
        parent_task_id: '999',
        parent_task_title: 'Task cha trang khác',
      },
    ],
    total: 25,
    page: 1,
    limit: 20,
    total_pages: 2,
    allowed_priorities: ['HIGH', 'MEDIUM', 'LOW'],
  };

  const parsed = parsePersonalTasks(tasksData);
  const organized = organizeTasksForDisplay(parsed);
  assert.deepEqual(
    organized.map((item) => [item.task.id, item.depth, item.hasDetachedParent]),
    [
      ['10', 0, false],
      ['12', 1, false],
      ['11', 0, false],
      ['13', 0, true],
    ]
  );

  const meta = parseTaskListMeta(tasksData, parsed.length);
  assert.deepEqual(meta, { page: 1, limit: 20, total: 25, total_pages: 2 });

  const html = renderToStaticMarkup(
    <PersonalAssistantWorkspaceView
      tasksState={{ data: tasksData, loading: false, reload: () => {} }}
      plansState={{ data: { items: [], total: 0 }, loading: false, reload: () => {} }}
    />
  );

  assert.ok(html.includes('60%'));
  assert.ok(html.includes('Công việc con của: Task cha gốc'));
  assert.ok(html.includes('Công việc con của: Task cha trang khác'));
  assert.ok(html.includes('Họp tuần 10'));
  assert.ok(html.includes('Thêm việc con'));
  assert.ok(html.includes('Mở lại công việc'));
  assert.ok(html.includes('value="partial"'));
  assert.ok(html.includes('Trang 1 / 2 · Tổng 25 công việc'));
});

test('PA-11 BFF & UI cover sort_by allowlist, priority dropdown fallback on empty list, and ADMIN rejection', () => {
  assert.deepEqual(DEFAULT_TASK_PRIORITIES, ['HIGH', 'MEDIUM', 'LOW']);
  assert.deepEqual(ALLOWED_TASK_SORT_MODES, ['default', 'priority_desc', 'priority_asc']);
  assert.ok(resolveOperation('personalTasks', 'USER').query?.includes('sort_by'));
  assert.throws(() => resolveOperation('personalTaskPriority', 'ADMIN', { id: '42' }), /FORBIDDEN/);

  // Even when tasks list is empty, priority filter and sort dropdowns still render standard options
  const emptyHtml = renderToStaticMarkup(
    <PersonalAssistantWorkspaceView
      tasksState={{ data: { items: [], total: 0 }, loading: false, reload: () => {} }}
      plansState={{ data: { items: [], total: 0 }, loading: false, reload: () => {} }}
    />
  );

  assert.ok(emptyHtml.includes('name="task_priority"'));
  assert.ok(emptyHtml.includes('value="HIGH"'));
  assert.ok(emptyHtml.includes('value="MEDIUM"'));
  assert.ok(emptyHtml.includes('value="LOW"'));
  assert.ok(emptyHtml.includes('name="task_sort"'));
  assert.ok(emptyHtml.includes('value="priority_desc"'));
  assert.ok(emptyHtml.includes('value="priority_asc"'));
});

test('PA-12 BFF & UI enforce ADMIN rejection on plans, track 0-100% progress, cancelled summary, and session progress_percent', () => {
  assert.throws(() => resolveOperation('personalPlans', 'ADMIN'), /FORBIDDEN/);
  assert.throws(() => resolveOperation('personalPlanDetail', 'ADMIN', { id: '5' }), /FORBIDDEN/);
  assert.throws(() => resolveOperation('personalPlanCreate', 'ADMIN'), /FORBIDDEN/);
  assert.throws(
    () => resolveOperation('personalPlanSessionComplete', 'ADMIN', { id: '5', sessionId: '1' }),
    /FORBIDDEN/
  );

  const parsedPlan = parsePersonalPlan({
    id: '7',
    title: 'Kế hoạch luyện thi',
    status: 'active',
    total_sessions: 4,
    completed_sessions: 1,
    remaining_sessions: 3,
    progress_percent: 25,
    sessions: [
      { id: '1', session_number: 1, title: 'Buổi 1', status: 'completed', progress_percent: 100 },
      { id: '2', session_number: 2, title: 'Buổi 2', status: 'partial', progress_percent: 75 },
    ],
  });
  assert.equal(parsedPlan.sessions[0].progress_percent, 100);
  assert.equal(parsedPlan.sessions[1].progress_percent, 75);
  assert.equal(parsedPlan.sessions[1].is_partial, true);
  assert.equal(parsedPlan.sessions[1].is_completed, false);

  const html = renderToStaticMarkup(
    <PersonalAssistantWorkspaceView
      tasksState={{
        data: {
          items: [
            {
              id: '51',
              title: 'Task cha đang làm dở',
              status: 'partial',
              priority: 'HIGH',
              progress_percent: 65,
            },
            {
              id: '52',
              title: 'Task con đã xong',
              status: 'completed',
              priority: 'MEDIUM',
              progress_percent: 100,
              parent_task_id: '51',
              parent_task_title: 'Task cha đang làm dở',
            },
          ],
          total: 2,
          summary: {
            completed_tasks: 1,
            pending_tasks: 1,
            cancelled_tasks: 3,
            total_tasks: 5,
            completion_percent: 50,
          },
        },
        loading: false,
        reload: () => {},
      }}
      plansState={{
        data: {
          items: [parsedPlan],
          total: 1,
        },
        loading: false,
        reload: () => {},
      }}
    />
  );

  assert.ok(html.includes('data-testid="pa-cancelled-tasks"'));
  assert.ok(html.includes('Trên tổng 5 công việc'));
  assert.ok(html.includes('aria-label="Tiến độ Task cha đang làm dở" aria-valuenow="65"'));
  assert.ok(html.includes('aria-label="Tiến độ Task con đã xong" aria-valuenow="100"'));
  assert.ok(html.includes('75%'));
});

test('PA-12 parent aggregated progress display falls back to own progress when null and flags 100% awaiting confirmation', () => {
  const withAggregated = parsePersonalTasks({
    items: [
      {
        id: '91',
        title: 'Task cha tổng hợp',
        status: 'in_progress',
        progress_percent: 25,
        aggregated_progress_percent: 100,
        active_subtask_count: 2,
      },
      {
        id: '92',
        title: 'Task không có việc con',
        status: 'partial',
        progress_percent: 40,
        aggregated_progress_percent: null,
        active_subtask_count: 0,
      },
    ],
  });

  assert.equal(getDisplayTaskProgress(withAggregated[0]), 100);
  assert.equal(getDisplayTaskProgress(withAggregated[1]), 40);

  const html = renderToStaticMarkup(
    <PersonalAssistantWorkspaceView
      tasksState={{
        data: { items: withAggregated, total: 2 },
        loading: false,
        reload: () => {},
      }}
      plansState={{ data: { items: [], total: 0 }, loading: false, reload: () => {} }}
    />
  );

  assert.ok(html.includes('aria-label="Tiến độ Task cha tổng hợp" aria-valuenow="100"'));
  assert.ok(html.includes('Tổng hợp (2 việc con)'));
  assert.ok(html.includes('Chờ xác nhận hoàn thành'));
  assert.ok(html.includes('aria-label="Tiến độ Task không có việc con" aria-valuenow="40"'));
});
