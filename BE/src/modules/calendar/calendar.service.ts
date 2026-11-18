import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CalendarRepository } from './calendar.repository';
import { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class CalendarService {
  constructor(private readonly repository: CalendarRepository) {}

  private date(value: string): Date { const d = new Date(value); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date-time'); return d; }
  private validateRange(start: Date, end: Date): void { if (start >= end) throw new BadRequestException('starts_at must be earlier than ends_at'); }

  async listEvents(user: AuthenticatedUser, from?: string, to?: string) {
    const start = from ? this.date(from) : undefined; const end = to ? this.date(to) : undefined;
    if (start && end && start >= end) throw new BadRequestException('from must be earlier than to');
    return { items: await this.repository.listEvents(user.id, start, end) };
  }
  async getEvent(user: AuthenticatedUser, id: string) {
    const event = await this.repository.findEvent(user.id, id);
    if (!event) throw new NotFoundException('Calendar event not found');
    return event;
  }
  async createEvent(user: AuthenticatedUser, dto: Record<string, unknown>, allowConflict = false) {
    const start = this.date(String(dto.starts_at)); const end = this.date(String(dto.ends_at)); this.validateRange(start, end);
    if (!allowConflict && await this.repository.overlaps(user.id, start, end)) throw new ConflictException({ code: 'CALENDAR_CONFLICT', message: 'Event overlaps an existing event', requires_confirmation: true });
    const id = await this.repository.createEvent(user.id, { ...dto, starts_at: start, ends_at: end });
    return this.repository.findEvent(user.id, id);
  }
  async updateEvent(user: AuthenticatedUser, id: string, dto: Record<string, unknown>, allowConflict = false) {
    const current = await this.repository.findEvent(user.id, id); if (!current) throw new NotFoundException('Calendar event not found');
    const start = this.date(String(dto.starts_at ?? current.starts_at.toISOString()));
    const end = this.date(String(dto.ends_at ?? current.ends_at.toISOString())); this.validateRange(start, end);
    if (!allowConflict && await this.repository.overlaps(user.id, start, end, id)) throw new ConflictException({ code: 'CALENDAR_CONFLICT', message: 'Event overlaps an existing event', requires_confirmation: true });
    await this.repository.updateEvent(user.id, id, {
      title: dto.title ?? current.title,
      description: dto.description ?? current.description,
      starts_at: start, ends_at: end,
      timezone: dto.timezone ?? current.timezone,
      recurrence_rule: dto.recurrence_rule ?? current.recurrence_rule,
    }); return this.repository.findEvent(user.id, id);
  }
  async deleteEvent(user: AuthenticatedUser, id: string) { if (!await this.repository.findEvent(user.id, id)) throw new NotFoundException('Calendar event not found'); await this.repository.deleteEvent(user.id, id); return { id, deleted: true }; }
}

@Injectable()
export class ReminderService {
  constructor(private readonly repository: CalendarRepository) {}
  async create(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const when = new Date(String(dto.remind_at)); if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid remind_at');
    if (when.getTime() <= Date.now()) throw new BadRequestException('remind_at must be in the future');
    if (dto.calendar_event_id && !await this.repository.findEvent(user.id, String(dto.calendar_event_id))) {
      throw new NotFoundException('Calendar event not found');
    }
    if (dto.device_id && !await this.repository.ownsDevice(user.id, String(dto.device_id))) {
      throw new NotFoundException('Device not found');
    }
    const key = `${user.id}:${dto.calendar_event_id ?? 'standalone'}:${when.toISOString()}:${dto.message}`;
    try {
      const id = await this.repository.createReminder(user.id, { ...dto, remind_at: when }, key); return this.repository.findReminder(id);
    } catch (error) {
      if (error instanceof Error && /duplicate|unique/i.test(error.message)) {
        throw new ConflictException({ code: 'REMINDER_DUPLICATE', message: 'An equivalent reminder already exists' });
      }
      throw error;
    }
  }
  async list(user: AuthenticatedUser, status?: string) { return { items: await this.repository.listReminders(user.id, status) }; }
  async due(limit = 20) { return { items: await this.repository.claimDue(Math.min(limit, 100)) }; }
  async ack(id: string, result: 'delivered' | 'failed', failureCode?: string) { const reminder = await this.repository.findReminder(id); if (!reminder) throw new NotFoundException('Reminder not found'); await this.repository.acknowledge(id, result, failureCode); return this.repository.findReminder(id); }
}
