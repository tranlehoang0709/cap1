import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ToolExecutionController } from '../src/modules/calendar/tool-execution.controller';
import { CalendarService } from '../src/modules/calendar/calendar.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { UsersService } from '../src/modules/users/users.service';

it('keeps robot writes closed even with scoped credentials, confirmation and the old flag set', async () => {
  const config = new ConfigService({
    auth: { accessTokenSecret: 'test-secret' },
    toolExecution: { serviceToken: 'test-service', calendarWritesEnabled: true },
  });
  const jwt = { verifyAsync: jest.fn().mockResolvedValue({
    sub: '3', typ: 'tool_delegation', scope: 'event.create', sid: 'session', did: '5',
  }) } as unknown as JwtService;
  const users = {
    getUserById: jest.fn().mockResolvedValue({ id: '3', status: 'active', email_verified_at: new Date() }),
    getUserRole: jest.fn().mockResolvedValue('USER'),
  } as unknown as UsersService;
  const devices = { getOwned: jest.fn().mockResolvedValue({ id: '5' }) } as unknown as DevicesService;
  const calendar = { createEvent: jest.fn() } as unknown as CalendarService;
  const controller = new ToolExecutionController(jwt, config, users, calendar, devices);
  const query = { session_id: 'session', device_id: '5', scope: 'event.create' as const };
  const body = { title: 'Fixture', starts_at: '2090-01-01T09:00:00Z',
    ends_at: '2090-01-01T10:00:00Z', idempotency_key: 'operation', confirmed: true,
    confirmation_proof: 'proof-bound-to-user-device-session-operation-and-content' };
  await expect(controller.eventCreate('Bearer delegated', 'test-service', query, body))
    .rejects.toMatchObject({ status: 403 });
  expect(calendar.createEvent).not.toHaveBeenCalled();
});
