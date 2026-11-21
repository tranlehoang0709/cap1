import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
    let id: string;
    if (!allowConflict && typeof (this.repository as CalendarRepository & { createEventAtomic?: unknown }).createEventAtomic === 'function') {
      try {
        id = await (this.repository as CalendarRepository & { createEventAtomic: (userId: string, data: Record<string, unknown>) => Promise<string> }).createEventAtomic(user.id, { ...dto, starts_at: start, ends_at: end });
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'CALENDAR_CONFLICT') throw new ConflictException({ code: 'CALENDAR_CONFLICT', message: 'Event overlaps an existing event', requires_confirmation: true });
        throw error;
      }
    } else {
      if (!allowConflict && await this.repository.overlaps(user.id, start, end)) throw new ConflictException({ code: 'CALENDAR_CONFLICT', message: 'Event overlaps an existing event', requires_confirmation: true });
      id = await this.repository.createEvent(user.id, { ...dto, starts_at: start, ends_at: end });
    }
    return this.repository.findEvent(user.id, id);
  }
  async checkConflict(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const start = this.date(String(dto.starts_at)); const end = this.date(String(dto.ends_at)); this.validateRange(start, end);
    return { has_conflict: await this.repository.overlaps(user.id, start, end), starts_at: start.toISOString(), ends_at: end.toISOString() };
  }
  async updateEvent(user: AuthenticatedUser, id: string, dto: Record<string, unknown>, allowConflict = false) {
    const current = await this.repository.findEvent(user.id, id); if (!current) throw new NotFoundException('Calendar event not found');
    const start = this.date(String(dto.starts_at ?? current.starts_at.toISOString()));
    const end = dto.ends_at == null ? current.ends_at : this.date(String(dto.ends_at));
    if (end) this.validateRange(start, end);
    if (!allowConflict && await this.repository.overlaps(user.id, start, end ?? start, id)) throw new ConflictException({ code: 'CALENDAR_CONFLICT', message: 'Event overlaps an existing event', requires_confirmation: true });
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
    const legacyKey = `${user.id}:${dto.calendar_event_id ?? 'standalone'}:${when.toISOString()}:${dto.message}`;
    const key = 'calendar:v1:' + createHash('sha256').update(legacyKey.normalize('NFC')).digest('hex');
    try {
      const id = await this.repository.createReminder(user.id, { ...dto, remind_at: when }, key, legacyKey); return this.repository.findReminder(id);
    } catch (error) {
      if (error instanceof Error && ['ER_DUP_ENTRY', 'REMINDER_DUPLICATE'].includes(
        (error as Error & { code?: string }).code ?? ''
      )) {
        throw new ConflictException({ code: 'REMINDER_DUPLICATE', message: 'An equivalent reminder already exists' });
      }
      throw error;
    }
  }
  async list(user: AuthenticatedUser, status?: string) { return { items: await this.repository.listReminders(user.id, status) }; }
  async due(limit = 20) { return { items: await this.repository.claimDue(Math.min(limit, 100)) }; }
  async ack(id: string, result: 'delivered' | 'failed', failureCode?: string) { const reminder = await this.repository.findReminder(id); if (!reminder) throw new NotFoundException('Reminder not found'); await this.repository.acknowledge(id, result, failureCode); return this.repository.findReminder(id); }

  async confirmReceipt(user: AuthenticatedUser, reminderId: string, deliveryId: string) {
    for (const id of [reminderId, deliveryId]) {
      if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
        throw new BadRequestException('Invalid reminder or delivery ID');
      }
    }
    return this.repository.confirmReceipt(user.id, reminderId, deliveryId);
  }
}
