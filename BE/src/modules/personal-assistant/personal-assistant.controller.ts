import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  AcknowledgeReminderDto,
  CancelTaskDto,
  CompleteActionDto,
  CreateEventDto,
  CreateMemoryDto,
  CreatePlanDto,
  CreateReminderDto,
  CreateTaskDto,
  ListEventsQueryDto,
  ListMemoriesQueryDto,
  ListPlansQueryDto,
  ListRemindersQueryDto,
  ListTasksQueryDto,
  ReopenTaskDto,
  ResolveTaskReferenceDto,
  UpdateEventDto,
  UpdateMemoryDto,
  UpdateReminderDto,
  UpdateTaskDto,
  UpdateTaskPriorityDto,
} from './dto/personal-assistant.dto';
import { PersonalAssistantService } from './personal-assistant.service';

@ApiTags('personal-assistant')
@ApiBearerAuth()
@Controller()
export class PersonalAssistantController {
  constructor(private readonly pa: PersonalAssistantService) {}

  @Get('user/tasks')
  @Roles('USER')
  @ApiOperation({ summary: 'List personal tasks with priority ordering and task progress summary (PA-10, PA-11, PA-12)' })
  listTasks(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTasksQueryDto) {
    return this.pa.listTasks(user.id, query);
  }

  @Post('user/tasks/resolve')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a personal task by ID or title reference, detecting ambiguity (PA-10)' })
  resolveTask(@CurrentUser() user: AuthenticatedUser, @Body() dto: ResolveTaskReferenceDto) {
    return this.pa.resolveTaskReference(user.id, dto.reference);
  }

  @Get('user/tasks/:id')
  @Roles('USER')
  @ApiOperation({ summary: 'Retrieve personal task details (PA-10)' })
  getTask(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.getTask(user.id, id);
  }

  @Post('user/tasks')
  @Roles('USER')
  @ApiOperation({ summary: 'Create a new personal task (PA-10)' })
  createTask(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskDto) {
    return this.pa.createTask(user.id, dto);
  }

  @Patch('user/tasks/:id')
  @Roles('USER')
  @ApiOperation({ summary: 'Edit an existing personal task (PA-10)' })
  updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto
  ) {
    return this.pa.updateTask(user.id, id, dto);
  }

  @Patch('user/tasks/:id/priority')
  @Roles('USER')
  @ApiOperation({ summary: 'Update task priority while preserving other task fields (PA-11)' })
  updatePriority(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskPriorityDto
  ) {
    return this.pa.updateTaskPriority(user.id, id, dto);
  }

  @Post('user/tasks/:id/complete')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark personal task completed idempotently (PA-10, PA-12)' })
  completeTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteActionDto
  ) {
    return this.pa.completeTask(user.id, id, dto);
  }

  @Post('user/tasks/:id/reopen')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a completed personal task back to pending or in_progress (PA-10)' })
  reopenTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReopenTaskDto
  ) {
    return this.pa.reopenTask(user.id, id, dto);
  }

  @Post('user/tasks/:id/cancel')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel personal task (PA-10)' })
  cancelTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelTaskDto
  ) {
    return this.pa.cancelTask(user.id, id, dto);
  }

  @Delete('user/tasks/:id')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete personal task (PA-10)' })
  deleteTask(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.deleteTask(user.id, id);
  }

  @Get('user/plans')
  @Roles('USER')
  @ApiOperation({ summary: 'List personal multi-session plans and authoritative progress (PA-12)' })
  listPlans(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPlansQueryDto) {
    return this.pa.listPlans(user.id, query);
  }

  @Get('user/plans/:id')
  @Roles('USER')
  @ApiOperation({ summary: 'Retrieve personal plan details and session progress (PA-12)' })
  getPlan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.getPlan(user.id, id);
  }

  @Post('user/plans')
  @Roles('USER')
  @ApiOperation({ summary: 'Create a multi-session personal plan (PA-12)' })
  createPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlanDto) {
    return this.pa.createPlan(user.id, dto);
  }

  @Post('user/plans/:id/sessions/:sessionId/complete')
  @Roles('USER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a session in a personal plan idempotently (PA-12)' })
  completePlanSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CompleteActionDto
  ) {
    return this.pa.completePlanSession(user.id, id, sessionId, dto);
  }

  // =========================================================================
  // personal_events (Personal Schedule & Events)
  // =========================================================================

  @Get('user/events')
  @ApiOperation({ summary: 'List personal schedule events with conflict detection' })
  listEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEventsQueryDto) {
    return this.pa.listEvents(user.id, query);
  }

  @Get('user/events/:id')
  @ApiOperation({ summary: 'Retrieve personal schedule event details' })
  getEvent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.getEvent(user.id, id);
  }

  @Post('user/events')
  @ApiOperation({ summary: 'Create a new personal schedule event' })
  createEvent(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.pa.createEvent(user.id, dto);
  }

  @Patch('user/events/:id')
  @ApiOperation({ summary: 'Update an existing personal schedule event' })
  updateEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto
  ) {
    return this.pa.updateEvent(user.id, id, dto);
  }

  @Delete('user/events/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a personal schedule event' })
  deleteEvent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.deleteEvent(user.id, id);
  }

  // =========================================================================
  // personal_reminders & reminder_deliveries (Reminders & Delivery History)
  // =========================================================================

  @Get('user/reminders')
  @ApiOperation({ summary: 'List personal reminders and delivery tracking' })
  listReminders(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRemindersQueryDto) {
    return this.pa.listReminders(user.id, query);
  }

  @Get('user/reminders/:id')
  @ApiOperation({ summary: 'Retrieve personal reminder details and deliveries' })
  getReminder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.getReminder(user.id, id);
  }

  @Post('user/reminders')
  @ApiOperation({ summary: 'Create a personal reminder' })
  createReminder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReminderDto) {
    return this.pa.createReminder(user.id, dto);
  }

  @Patch('user/reminders/:id')
  @ApiOperation({ summary: 'Update a personal reminder' })
  updateReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto
  ) {
    return this.pa.updateReminder(user.id, id, dto);
  }

  @Post('user/reminders/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge a personal reminder and record delivery acknowledgment' })
  acknowledgeReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AcknowledgeReminderDto
  ) {
    return this.pa.acknowledgeReminder(user.id, id, dto);
  }

  @Delete('user/reminders/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a personal reminder and its delivery records' })
  deleteReminder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.deleteReminder(user.id, id);
  }

  // =========================================================================
  // personal_memories (Personal Long-term Memories)
  // =========================================================================

  @Get('user/memories')
  @ApiOperation({ summary: 'List personal memories for the authenticated user' })
  listMemories(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMemoriesQueryDto) {
    return this.pa.listMemories(user.id, query);
  }

  @Get('user/memories/:id')
  @ApiOperation({ summary: 'Retrieve personal memory details' })
  getMemory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.getMemory(user.id, id);
  }

  @Post('user/memories')
  @ApiOperation({ summary: 'Create or upsert a personal memory by memory_key' })
  createMemory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMemoryDto) {
    return this.pa.createMemory(user.id, dto);
  }

  @Patch('user/memories/:id')
  @ApiOperation({ summary: 'Update an existing personal memory' })
  updateMemory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto
  ) {
    return this.pa.updateMemory(user.id, id, dto);
  }

  @Delete('user/memories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a personal memory' })
  deleteMemory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pa.deleteMemory(user.id, id);
  }
}
