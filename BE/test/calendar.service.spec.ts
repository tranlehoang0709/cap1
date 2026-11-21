import { ConflictException, NotFoundException } from '@nestjs/common';
import { CalendarRepository } from '../src/modules/calendar/calendar.repository';
import { CalendarService, ReminderService } from '../src/modules/calendar/calendar.service';
import { AuthenticatedUser } from '../src/modules/auth/auth.types';

const user: AuthenticatedUser = { id: '7', email: 'user@example.com', display_name: 'User', role: 'USER' };

function repoMock() {
  return {
    overlaps: jest.fn(), findEvent: jest.fn(), createEvent: jest.fn(), updateEvent: jest.fn(), deleteEvent: jest.fn(),
    ownsDevice: jest.fn(), createReminder: jest.fn(), findReminder: jest.fn(), listReminders: jest.fn(), claimDue: jest.fn(), acknowledge: jest.fn(),
  } as unknown as jest.Mocked<CalendarRepository>;
}

describe('CalendarService', () => {
  it('requires explicit confirmation for an overlapping event', async () => {
    const repository = repoMock(); repository.overlaps.mockResolvedValue(true);
    await expect(new CalendarService(repository).createEvent(user, {
      title: 'Busy', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T11:00:00Z',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createEvent).not.toHaveBeenCalled();
  });

  it('rejects a reminder that references another user event or device', async () => {
    const repository = repoMock(); repository.findEvent.mockResolvedValue(null); repository.ownsDevice.mockResolvedValue(false);
    const service = new ReminderService(repository);
    await expect(service.create(user, { calendar_event_id: '99', message: 'x', remind_at: '2030-01-01T10:00:00Z' })).rejects.toBeInstanceOf(NotFoundException);
    repository.findEvent.mockResolvedValue({} as never);
    await expect(service.create(user, { device_id: '99', message: 'x', remind_at: '2030-01-01T10:00:00Z' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses a stable delivery key within the MySQL limit and checks the legacy key', async () => {
    const repository = repoMock();
    repository.createReminder.mockResolvedValue('11');
    const service = new ReminderService(repository);
    const reminder = { message: 'x'.repeat(180), remind_at: '2099-01-01T10:00:00Z' };
    await service.create(user, reminder);
    await service.create(user, reminder);
    const [, , key, legacyKey] = repository.createReminder.mock.calls[0];
    expect(key).toMatch(/^calendar:v1:[a-f0-9]{64}$/);
    expect(repository.createReminder.mock.calls[1][2]).toBe(key);
    expect(legacyKey?.endsWith(reminder.message)).toBe(true);
  });
});
