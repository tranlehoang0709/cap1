import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlanDraft, scheduleRange, summarizeEvents } from '../src/lib/personal-planning';
import { parsePersonalEvents, validatePersonalAssistantBody } from '../src/lib/personal-assistant';

test('PA-06 accepts structured AI steps and rejects malformed or empty drafts', () => {
  const steps = parsePlanDraft('```json\n{"steps":[{"title":"Đọc yêu cầu","description":"30 phút","priority":"HIGH","due_at":null}]}\n```');
  assert.equal(steps[0].title, 'Đọc yêu cầu');
  assert.throws(() => parsePlanDraft('{"steps":[]}'));
  assert.throws(() => parsePlanDraft('{"steps":[{"title":"A","priority":"URGENT"}]}'));
  assert.throws(() => parsePlanDraft('dịch vụ không trả JSON'));
  const payload = validatePersonalAssistantBody('personalPlanCreate', { title: 'Kế hoạch', goal: 'Đọc yêu cầu', confirmed: true, total_sessions: steps.length, sessions: steps });
  assert.equal((payload.sessions as unknown[]).length, 1);
});

test('PA-04 rejects create and update without explicit consent', () => {
  assert.throws(() => validatePersonalAssistantBody('personalMemoryCreate', { memory_key: 'habit', memory_value: 'Đọc sách' }));
  assert.throws(() => validatePersonalAssistantBody('personalMemoryUpdate', { consent: false, memory_value: 'Đọc sách' }));
  const payload = validatePersonalAssistantBody('personalMemoryUpdate', { consent: true, memory_value: 'Đọc sách', category: null });
  assert.equal(payload.consent, true);
});

test('PA-08 calculates inclusive local days and Monday-to-Sunday weeks', () => {
  const day = scheduleRange('2026-11-17', 'day', '');
  assert.equal(day.start.toISOString(), '2026-11-16T17:00:00.000Z');
  assert.equal(day.end.toISOString(), '2026-11-17T17:00:00.000Z');
  const week = scheduleRange('2026-11-22', 'week', '');
  assert.equal(week.start.toISOString(), '2026-11-15T17:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-11-22T17:00:00.000Z');
  assert.throws(() => scheduleRange('2026-11-20', 'range', '2026-11-17'));
});

test('PA-08 includes overlapping activities and orders by time across statuses', () => {
  const events = parsePersonalEvents({ items: [
    { id: '1', title: 'Sau', start_at: '2026-11-17T12:00:00Z', status: 'scheduled' },
    { id: '2', title: 'Trước', start_at: '2026-11-17T01:00:00Z', status: 'completed' },
    { id: '3', title: 'Kéo dài', start_at: '2026-11-16T23:00:00Z', end_at: '2026-11-17T02:00:00Z' },
    { id: '4', title: 'Ngoài khoảng', start_at: '2026-11-18T00:00:00Z' },
  ] });
  const start = new Date('2026-11-17T00:00:00Z');
  const end = new Date('2026-11-18T00:00:00Z');
  assert.deepEqual(summarizeEvents(events, start, end).map((event) => event.id), ['3', '2', '1']);
  assert.deepEqual(summarizeEvents([], start, end), []);
});
