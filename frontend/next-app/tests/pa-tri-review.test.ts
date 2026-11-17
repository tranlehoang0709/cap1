import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleRange, summarizeEvents, loadScheduleEvents, parsePlanDraft, formatScheduleDate, movePlanStep } from '../src/lib/personal-planning';
import { validatePersonalAssistantBody, memoryAwareChatContent, parsePersonalEvents } from '../src/lib/personal-assistant';

const plan = { title: 'Mục tiêu học tập', goal: 'Hoàn thiện PA', total_sessions: 1,
  sessions: [{ title: 'Đọc yêu cầu', priority: 'MEDIUM' }] };

test('PA-08 uses Vietnam midnight even when the runtime timezone is UTC', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const result = scheduleRange('2026-11-17', 'day', '');
    assert.equal(result.start.toISOString(), '2026-11-16T17:00:00.000Z');
    assert.equal(result.end.toISOString(), '2026-11-17T17:00:00.000Z');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('PA-08 rejects normalized impossible calendar dates', () => {
  assert.throws(() => scheduleRange('2026-02-30', 'day', ''));
});

test('PA-06 rejects explicit steps without confirmation', () => {
  assert.throws(() => validatePersonalAssistantBody('personalPlanCreate', plan));
});

test('PA-06 rejects blank goals for explicit steps', () => {
  assert.throws(() => validatePersonalAssistantBody('personalPlanCreate', { ...plan, confirmed: true, goal: '   ' }));
});

test('PA-06 accepts confirmed explicit steps and rejects empty, mismatched or duplicate steps', () => {
  const valid = { ...plan, confirmed: true };
  assert.equal(validatePersonalAssistantBody('personalPlanCreate', valid).confirmed, true);
  for (const invalid of [
    { ...valid, sessions: [] },
    { ...valid, total_sessions: 2 },
    { ...valid, total_sessions: 2, sessions: [
      { title: 'A', session_number: 1 }, { title: 'B', session_number: 1 },
    ] },
    { ...valid, sessions: [{ title: '   ' }] },
    { ...valid, sessions: [{ title: 'A', priority: 'URGENT' }] },
    { ...valid, sessions: [{ title: 'A', due_at: 'not-a-date' }] },
  ]) assert.throws(() => validatePersonalAssistantBody('personalPlanCreate', invalid));
});

test('PA-06 rejects empty, truncated and incomplete AI drafts without saving anything', () => {
  for (const content of ['', '{"steps":[', '{"steps":[]}', '{"steps":[{"title":"A"}]}']) {
    assert.throws(() => parsePlanDraft(content));
  }
});

test('PA-08 handles week, month and year transitions in Vietnam time', () => {
  const week = scheduleRange('2027-01-01', 'week', '');
  assert.equal(week.start.toISOString(), '2026-12-27T17:00:00.000Z');
  assert.equal(week.end.toISOString(), '2027-01-03T17:00:00.000Z');
  const range = scheduleRange('2026-12-31', 'range', '2027-01-01');
  assert.equal(range.end.toISOString(), '2027-01-01T17:00:00.000Z');
  assert.throws(() => scheduleRange('2026-11-20', 'range', '2026-11-19'));
  assert.match(formatScheduleDate('2026-11-16T17:00:00.000Z'), /17\/11\/26/);
});

test('PA-08 counts only overlapping events at inclusive-start, exclusive-end boundaries', () => {
  const { start, end } = scheduleRange('2026-11-17', 'day', '');
  const events = parsePersonalEvents({ items: [
    { id: '1', title: 'Multi-day', start_at: '2026-11-14T10:00:00Z', end_at: '2026-11-18T10:00:00Z' },
    { id: '2', title: 'At start', start_at: start.toISOString(), status: 'completed' },
    { id: '3', title: 'Before midnight', start_at: '2026-11-16T16:00:00Z', end_at: '2026-11-16T18:00:00Z' },
    { id: '4', title: 'Ends at start', start_at: '2026-11-16T10:00:00Z', end_at: start.toISOString() },
    { id: '5', title: 'At end', start_at: end.toISOString() },
  ] });
  assert.deepEqual(summarizeEvents(events, start, end).map(event => event.id), ['1', '3', '2']);
  assert.equal(events.length, 5);
});

test('PA-08 reads all pages, deduplicates IDs and refuses partial results on failure', async () => {
  const queries: Record<string, string>[] = [];
  const end = new Date('2026-11-17T17:00:00Z');
  const event = { id: '1', title: 'A', start_at: '2026-11-17T01:00:00Z' };
  const result = await loadScheduleEvents(end, async query => {
    queries.push(query);
    return { total_pages: 2, items: query.page === '1' ? [event] : [event, { ...event, id: '2' }] };
  });
  assert.deepEqual(result.map(item => item.id), ['1', '2']);
  assert.deepEqual(queries.map(query => query.page), ['1', '2']);
  assert.equal(queries[0].from, undefined);
  assert.equal(queries[0].to, '2026-11-17T16:59:59.999Z');
  await assert.rejects(loadScheduleEvents(end, async query => {
    if (query.page === '2') throw new Error('network');
    return { total_pages: 2, items: [event] };
  }), /network/);
  await assert.rejects(loadScheduleEvents(end, async () => ({ total_pages: 'bad', items: [] })));
  assert.deepEqual(await loadScheduleEvents(end, async () => ({ total_pages: 0, items: [] })), []);
});

test('PA-04 attaches memories only on opt-in and reads fresh data for each request', async () => {
  let calls = 0;
  let items = [{ id: '1', memory_key: 'preference', memory_value: 'Read documentation' }];
  const read = async (query: Record<string, string>) => {
    calls++;
    assert.equal(query.search, 'preference');
    return { total_pages: 1, items };
  };
  assert.equal(await memoryAwareChatContent('Question', false, 'preference', read), 'Question');
  assert.equal(calls, 0);
  assert.match(await memoryAwareChatContent('Question', true, ' preference ', read), /Read documentation/);
  items = [];
  assert.equal(await memoryAwareChatContent('Question', true, 'preference', read), 'Question');
  assert.equal(await memoryAwareChatContent('Next question', false, 'preference', read), 'Next question');
  assert.equal(calls, 2);
});

test('PA-04 memory request refuses failed loads, malformed pages and oversized context', async () => {
  await assert.rejects(memoryAwareChatContent('Q', true, '', async () => { throw new Error('network'); }), /network/);
  await assert.rejects(memoryAwareChatContent('Q', true, '', async () => ({ items: [], total_pages: null })));
  await assert.rejects(memoryAwareChatContent('Q', true, '', async () => ({ total_pages: 1, items: [
    { id: '1', memory_key: 'key', memory_value: 'a'.repeat(16000) },
  ] })), /giới hạn/);
});

test('PA-06 reorders steps without mutating the prior confirmed draft', () => {
  const steps = [{ title: 'PA-04', priority: 'HIGH' as const }, { title: 'PA-06', priority: 'MEDIUM' as const }, { title: 'PA-08', priority: 'LOW' as const }];
  const before = JSON.stringify(steps);
  const after = movePlanStep(steps, 0, 2);
  assert.deepEqual(after.map(step => step.title), ['PA-06', 'PA-08', 'PA-04']);
  assert.equal(JSON.stringify(steps), before);
  assert.notEqual(JSON.stringify(after), before);
  assert.throws(() => movePlanStep(steps, 0, -1));
});
