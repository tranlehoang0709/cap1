import { z } from 'zod';
import { parsePersonalEvents, type PersonalEvent } from './personal-assistant';
import { object } from './contracts';

export const planStepSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
export type PlanStep = z.infer<typeof planStepSchema>;

export function parsePlanDraft(content: string): PlanStep[] {
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const result = z.object({ steps: z.array(planStepSchema).min(1).max(30) }).strict().parse(JSON.parse(json));
  return result.steps;
}

export const SCHEDULE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function vietnamMidnight(day: string): Date {
  const result = new Date(`${day}T00:00:00+07:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(result.getTime()) ||
      new Date(result.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10) !== day) {
    throw new Error('Chọn ngày hợp lệ.');
  }
  return result;
}

export function formatScheduleDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: SCHEDULE_TIME_ZONE,
  }).format(new Date(value));
}

export function scheduleRange(day: string, mode: 'day' | 'week' | 'range', lastDay: string) {
  let start = vietnamMidnight(day);
  let end = new Date(start.getTime() + DAY_MS);
  if (mode === 'week') {
    const weekday = new Date(start.getTime() + VIETNAM_OFFSET_MS).getUTCDay();
    start = new Date(start.getTime() - ((weekday + 6) % 7) * DAY_MS);
    end = new Date(start.getTime() + 7 * DAY_MS);
  }
  if (mode === 'range') end = new Date(vietnamMidnight(lastDay).getTime() + DAY_MS);
  if (start >= end) throw new Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  return { start, end };
}

export function summarizeEvents(events: PersonalEvent[], start: Date, end: Date): PersonalEvent[] {
  return events.filter((event) => {
    const begins = Date.parse(event.start_at);
    const finishes = event.end_at ? Date.parse(event.end_at) : begins;
    return begins < end.getTime() && (begins >= start.getTime() || finishes > start.getTime());
  }).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id));
}

export async function loadScheduleEvents(
  end: Date,
  readPage: (query: Record<string, string>) => Promise<unknown>,
): Promise<PersonalEvent[]> {
  const events = new Map<string, PersonalEvent>();
  let page = 1;
  let pages = 1;
  // Existing API boundaries filter start_at, so retain earlier overlapping events.
  do {
    const data = await readPage({ page: String(page), limit: '100', to: new Date(end.getTime() - 1).toISOString() });
    const meta = object(data);
    if (!Number.isInteger(meta.total_pages) || Number(meta.total_pages) < 0) {
      throw new Error('Backend trả phân trang lịch không hợp lệ.');
    }
    pages = Number(meta.total_pages);
    for (const event of parsePersonalEvents(data)) events.set(event.id, event);
    page++;
  } while (page <= pages);
  return [...events.values()];
}

export function movePlanStep(steps: PlanStep[], from: number, to: number): PlanStep[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= steps.length || to >= steps.length) {
    throw new Error('Vị trí bước không hợp lệ.');
  }
  const reordered = [...steps];
  const [step] = reordered.splice(from, 1);
  reordered.splice(to, 0, step);
  return reordered;
}
