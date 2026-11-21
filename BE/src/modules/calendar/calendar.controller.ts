import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CalendarEventQueryDto, CreateCalendarEventDto, CreateReminderDto, DueReminderQueryDto, ReminderAckDto, ReminderQueryDto, UpdateCalendarEventDto } from './calendar.dto';
import { CalendarService, ReminderService } from './calendar.service';

@ApiTags('calendar') @ApiBearerAuth() @Controller('user/calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}
  @Get('events') @ApiOperation({ summary: 'List calendar events owned by the current User' }) list(@CurrentUser() user: AuthenticatedUser, @Query() q: CalendarEventQueryDto) { return this.calendar.listEvents(user, q.from, q.to); }
  @Post('events') @ApiOperation({ summary: 'Create a personal calendar event; set confirm_conflict=true to accept overlap' }) create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCalendarEventDto) { return this.calendar.createEvent(user, dto as unknown as Record<string, unknown>, dto.confirm_conflict === true); }
  @Get('events/:id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.calendar.getEvent(user, id); }
  @Patch('events/:id') update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCalendarEventDto) { return this.calendar.updateEvent(user, id, dto as unknown as Record<string, unknown>, dto.confirm_conflict === true); }
  @Delete('events/:id') remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.calendar.deleteEvent(user, id); }
}

@ApiTags('reminders') @ApiBearerAuth() @Controller('user/calendar/reminders')
export class ReminderController {
  constructor(private readonly reminders: ReminderService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query() q: ReminderQueryDto) { return this.reminders.list(user, q.status); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReminderDto) { return this.reminders.create(user, dto as unknown as Record<string, unknown>); }
  @Post(':id/deliveries/:deliveryId/acknowledge') @HttpCode(200) @Roles('USER')
  confirmReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string,
    @Param('deliveryId') deliveryId: string) {
    return this.reminders.confirmReceipt(user, id, deliveryId);
  }
}

@ApiTags('internal-reminders') @ApiBearerAuth() @Controller('internal/reminders') @Roles('ADMIN')
export class InternalReminderController {
  constructor(private readonly reminders: ReminderService) {}
  @Get('due') due(@Query() q: DueReminderQueryDto) { return this.reminders.due(q.limit); }
  @Post(':id/ack') ack(@Param('id') id: string, @Body() dto: ReminderAckDto) { return this.reminders.ack(id, dto.result, dto.failure_code); }
}
