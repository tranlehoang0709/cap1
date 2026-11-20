import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  AcknowledgeReminderDto,
  ALLOWED_EVENT_STATUSES,
  ALLOWED_REMINDER_CHANNELS,
  ALLOWED_REMINDER_STATUSES,
  ALLOWED_TASK_PRIORITIES,
  CancelTaskDto,
  CompleteActionDto,
  CreateEventDto,
  CreateMemoryDto,
  CreatePlanDto,
  CreateReminderDto,
  CreateTaskDto,
  EventStatus,
  ListEventsQueryDto,
  ListMemoriesQueryDto,
  ListPlansQueryDto,
  ListRemindersQueryDto,
  ListTasksQueryDto,
  ReminderChannel,
  ReminderStatus,
  ReopenTaskDto,
  TaskPriority,
  TaskStatus,
  UpdateEventDto,
  UpdateMemoryDto,
  UpdateReminderDto,
  UpdateTaskDto,
  UpdateTaskPriorityDto,
} from './dto/personal-assistant.dto';
import {
  PersonalAssistantRepository,
  PersonalEventRecord,
  PersonalMemoryRecord,
  PersonalPlanRecord,
  PersonalReminderRecord,
  PersonalTaskRecord,
} from './personal-assistant.repository';

function assertBigintId(value: string, label = 'identifier'): string {
  const trimmed = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(trimmed)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return trimmed;
}

function parseOptionalDueAt(raw: string | null | undefined): Date | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid due_at datetime value');
  }
  return parsed;
}

function parseOptionalDateOnly(raw: string | null | undefined, label: string): string | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const trimmed = raw.trim();
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new BadRequestException(`Invalid ${label} date value; expected YYYY-MM-DD`);
  }
  return trimmed;
}

function localMidnightUtc(date: Date, timezone: string): Date {
  const desired = date.getTime();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day),
      Number(fields.hour), Number(fields.minute));
    instant += desired - local;
  }
  return new Date(instant);
}

function timestampsMatch(expectedIso: string, actualIso: string): boolean {
  const expectedMs = Date.parse(expectedIso);
  const actualMs = Date.parse(actualIso);
  if (Number.isNaN(expectedMs) || Number.isNaN(actualMs)) {
    return expectedIso.trim() === actualIso.trim();
  }
  return Math.floor(expectedMs / 1000) === Math.floor(actualMs / 1000);
}

function taskAlertSweepDiagnostics(error: unknown): { message: string; stack?: string } {
  if (!(error instanceof Error)) return { message: 'Non-Error rejection (details withheld)' };

  // MySQL error text can contain bound values. Only expose known schema identifiers.
  const schemaError = /^Unknown column '(?:(?:t|p|r)\.)?(?:deleted_at|session_number|message|channel)' in '(?:where clause|field list|on clause|order clause)'$/.test(error.message);
  const invalidDate = error instanceof RangeError && error.message === 'Invalid time value';
  const message = schemaError || invalidDate ? error.message : 'Exception message withheld';

  // The first stack line repeats the original message, which may span several lines.
  const header = `${error.name}: ${error.message}\n`;
  const frames = error.stack?.startsWith(header) ? error.stack.slice(header.length) : undefined;
  return { message, stack: frames ? `Error: ${message}\n${frames}` : undefined };
}

@Injectable()
export class PersonalAssistantService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly repo: PersonalAssistantRepository) {}
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private readonly logger = new Logger(PersonalAssistantService.name);

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const sweep = () => {
      if (!this.running) this.running = this.repo.sweepTaskAlerts(new Date())
        .catch((error: unknown) => {
          const { message, stack } = taskAlertSweepDiagnostics(error);
          this.logger.error(`Personal task alert sweep failed; will retry. ${message}`, stack);
        })
        .finally(() => { this.running = null; });
    };
    sweep();
    this.timer = setInterval(sweep, 60000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.running) await this.running;
  }

  async listTasks(userId: string, query: ListTasksQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    if (query.plan_id) assertBigintId(query.plan_id, 'plan_id');
    if (query.parent_task_id) assertBigintId(query.parent_task_id, 'parent_task_id');
    const result = await this.repo.listTasks(userId, {
      page,
      limit,
      search: query.search,
      status: query.status,
      priority: query.priority,
      plan_id: query.plan_id,
      parent_task_id: query.parent_task_id,
      sort_by: query.sort_by,
    });
    return {
      ...result,
      page,
      limit,
      total_pages: Math.ceil(result.total / limit),
      allowed_priorities: [...ALLOWED_TASK_PRIORITIES],
    };
  }

  async listIncompleteTasks(userId: string, query: ListTasksQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const result = await this.repo.listIncompleteTasks(userId, page, limit);
    const missed_plans = await this.repo.getMissedPlanSessions(userId, new Date());
    return { ...result, page, limit, total_pages: Math.ceil(result.total / limit), missed_plans };
  }

  async taskReport(userId: string, period: string, date: string, timezone = 'UTC') {
    if (!['day', 'week', 'month'].includes(period)) throw new BadRequestException('Invalid period');
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
    catch { throw new BadRequestException('Invalid timezone'); }
    const parsed = parseOptionalDateOnly(date, 'date');
    if (!parsed) throw new BadRequestException('date is required');
    const start = new Date(`${parsed}T00:00:00.000Z`);
    if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    if (period === 'month') start.setUTCDate(1);
    const end = new Date(start);
    if (period === 'day') end.setUTCDate(end.getUTCDate() + 1);
    if (period === 'week') end.setUTCDate(end.getUTCDate() + 7);
    if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
    const startUtc = localMidnightUtc(start, timezone);
    const endUtc = localMidnightUtc(end, timezone);
    const counts = await this.repo.getTaskReport(userId, startUtc, endUtc);
    return { period, timezone, start_at: startUtc.toISOString(), end_at: endUtc.toISOString(), ...counts };
  }

  async taskDeadlines(userId: string) {
    return this.repo.getTaskDeadlines(userId, new Date());
  }

  private async resolveValidParentTaskId(
    conn: any,
    userId: string,
    rawParentId: string,
    selfTaskId?: string
  ): Promise<string> {
    const parentId = assertBigintId(rawParentId, 'parent_task_id');
    if (selfTaskId && parentId === selfTaskId) {
      throw new BadRequestException('A task cannot be its own parent');
    }
    const parent = await this.repo.findTaskByIdRaw(parentId, conn, true);
    if (!parent || parent.deleted_at) {
      throw new NotFoundException('Parent personal task was not found');
    }
    if (parent.user_id !== userId) {
      throw new ForbiddenException('Parent personal task does not belong to the authenticated user');
    }
    if (selfTaskId) {
      const visited = new Set<string>([selfTaskId, parentId]);
      let cursor = parent.parent_task_id;
      let steps = 0;
      while (cursor && steps < 64) {
        if (cursor === selfTaskId) {
          throw new BadRequestException('Circular parent-child task relationship is not allowed');
        }
        if (visited.has(cursor)) {
          break;
        }
        visited.add(cursor);
        const ancestor = await this.repo.findTaskByIdRaw(cursor, conn, true);
        if (!ancestor || ancestor.deleted_at || ancestor.user_id !== userId) {
          break;
        }
        cursor = ancestor.parent_task_id;
        steps += 1;
      }
    }
    return parentId;
  }

  async getTask(userId: string, taskId: string): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');
    const row = await this.repo.findTaskByIdRaw(id);
    if (!row || row.deleted_at) {
      throw new NotFoundException('Task was not found');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Task does not belong to the authenticated user');
    }
    const subtasks = await this.repo.findSubtasksByParentId(userId, id);
    const { deleted_at: _deleted, ...task } = row;
    void _deleted;
    return {
      ...task,
      subtasks,
    };
  }

  async createTask(userId: string, dto: CreateTaskDto): Promise<PersonalTaskRecord> {
    const title = (dto.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Task title must not be empty');
    }
    const priority: TaskPriority = dto.priority ?? 'MEDIUM';
    if (!ALLOWED_TASK_PRIORITIES.includes(priority)) {
      throw new BadRequestException(
        `Invalid priority; allowed values are ${ALLOWED_TASK_PRIORITIES.join(', ')}`
      );
    }
    const dueAt = parseOptionalDueAt(dto.due_at);
    const description = dto.description?.trim() ? dto.description.trim() : null;
    const planId = dto.plan_id ? assertBigintId(dto.plan_id, 'plan_id') : null;
    const eventId = dto.event_id ? assertBigintId(dto.event_id, 'event_id') : null;
    const sessionNumber =
      dto.session_number !== undefined && dto.session_number !== null
        ? Number(dto.session_number)
        : null;

    return this.repo.withTransaction(async (conn) => {
      if (planId) {
        const plan = await this.repo.findPlanByIdRaw(planId, conn, true);
        if (!plan || plan.deleted_at) {
          throw new NotFoundException('Associated personal plan was not found');
        }
        if (String(plan.user_id) !== userId) {
          throw new ForbiddenException('Personal plan does not belong to the authenticated user');
        }
        if (sessionNumber !== null) {
          const totalSessions = Number(plan.total_sessions ?? 1);
          if (sessionNumber < 1 || sessionNumber > totalSessions) {
            throw new BadRequestException(
              `session_number must be between 1 and ${totalSessions} for this plan`
            );
          }
          const existingSession = await this.repo.findSessionTaskByPlanAndNumber(
            planId,
            sessionNumber,
            conn,
            true
          );
          if (existingSession) {
            throw new ConflictException(
              `Session ${sessionNumber} already exists in plan #${planId}`
            );
          }
        }
      }

      if (eventId) {
        const event = await this.repo.findEventByIdRaw(eventId, conn);
        if (!event) throw new NotFoundException('Associated personal event was not found');
        if (event.user_id !== userId) throw new ForbiddenException('Personal event does not belong to the authenticated user');
      }
      const parentTaskId = dto.parent_task_id
        ? await this.resolveValidParentTaskId(conn, userId, dto.parent_task_id)
        : null;
      return this.repo.insertTask(conn, {
        user_id: userId,
        event_id: eventId,
        parent_task_id: parentTaskId,
        plan_id: planId,
        session_number: sessionNumber,
        title,
        description,
        status: 'pending',
        priority,
        progress_percent: 0,
        due_at: dueAt,
      });
    });
  }

  async updateTask(
    userId: string,
    taskId: string,
    dto: UpdateTaskDto
  ): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');
    if (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.due_at === undefined &&
      dto.priority === undefined &&
      dto.status === undefined &&
      dto.progress_percent === undefined &&
      dto.plan_id === undefined &&
      dto.event_id === undefined &&
      dto.parent_task_id === undefined &&
      dto.session_number === undefined
    ) {
      throw new BadRequestException('At least one task field must be provided for update');
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      if (current.status === 'cancelled') {
        throw new ConflictException('Cancelled task cannot be edited');
      }
      if (current.status === 'completed' && (dto.status !== undefined || dto.progress_percent !== undefined)) {
        throw new ConflictException('Completed task progress cannot be changed');
      }
      if (
        dto.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, current.updated_at)
      ) {
        throw new ConflictException('Task was modified by another request');
      }

      const nextTitle = dto.title !== undefined ? dto.title.trim() : current.title;
      if (!nextTitle) {
        throw new BadRequestException('Task title must not be empty');
      }
      const nextDescription =
        dto.description !== undefined
          ? dto.description?.trim()
            ? dto.description.trim()
            : null
          : current.description;
      const nextDueAt =
        dto.due_at !== undefined
          ? parseOptionalDueAt(dto.due_at)
          : parseOptionalDueAt(current.due_at);
      const nextPriority: TaskPriority = dto.priority ?? current.priority;
      if (!ALLOWED_TASK_PRIORITIES.includes(nextPriority)) {
        throw new BadRequestException(
          `Invalid priority; allowed values are ${ALLOWED_TASK_PRIORITIES.join(', ')}`
        );
      }

      // PA-12 rule: partial progress never automatically marks a task completed.
      let nextStatus: TaskStatus = dto.status ?? current.status;
      let nextProgress =
        dto.progress_percent !== undefined ? Number(dto.progress_percent) : current.progress_percent;
      if (dto.status === 'pending' && dto.progress_percent === undefined) {
        nextProgress = 0;
      }
      if (nextProgress > 0 && nextProgress < 100 && nextStatus === 'pending') {
        nextStatus = 'in_progress';
      }
      if (nextStatus !== 'completed' && nextProgress >= 100) {
        nextProgress = 99;
      }

      const nextPlanId =
        dto.plan_id !== undefined
          ? dto.plan_id
            ? assertBigintId(dto.plan_id, 'plan_id')
            : null
          : current.plan_id;
      const nextSessionNumber =
        dto.session_number !== undefined ? dto.session_number : current.session_number;

      if (nextPlanId) {
        const plan = await this.repo.findPlanByIdRaw(nextPlanId, conn, true);
        if (!plan || plan.deleted_at) {
          throw new NotFoundException('Associated personal plan was not found');
        }
        if (String(plan.user_id) !== userId) {
          throw new ForbiddenException('Personal plan does not belong to the authenticated user');
        }
        if (nextSessionNumber !== null) {
          const totalSessions = Number(plan.total_sessions ?? 1);
          if (nextSessionNumber < 1 || nextSessionNumber > totalSessions) {
            throw new BadRequestException(
              `session_number must be between 1 and ${totalSessions} for this plan`
            );
          }
          const existingSession = await this.repo.findSessionTaskByPlanAndNumber(
            nextPlanId,
            nextSessionNumber,
            conn,
            true
          );
          if (existingSession && existingSession.id !== id) {
            throw new ConflictException(
              `Session ${nextSessionNumber} already exists in plan #${nextPlanId}`
            );
          }
        }
      }

      const nextEventId = dto.event_id === undefined ? current.event_id : dto.event_id ? assertBigintId(dto.event_id, 'event_id') : null;
      if (nextEventId) {
        const event = await this.repo.findEventByIdRaw(nextEventId, conn);
        if (!event) throw new NotFoundException('Associated personal event was not found');
        if (event.user_id !== userId) throw new ForbiddenException('Personal event does not belong to the authenticated user');
      }
      const nextParentTaskId =
        dto.parent_task_id === undefined
          ? current.parent_task_id
          : dto.parent_task_id
            ? await this.resolveValidParentTaskId(conn, userId, dto.parent_task_id, id)
            : null;
      const updated = await this.repo.updateTaskFields(conn, id, {
        event_id: nextEventId,
        parent_task_id: nextParentTaskId,
        title: nextTitle,
        description: nextDescription,
        due_at: nextDueAt,
        priority: nextPriority,
        status: nextStatus,
        progress_percent: nextProgress,
        plan_id: nextPlanId,
        session_number: nextSessionNumber,
      });

      if (current.plan_id) await this.repo.syncPlanCompletionStatus(conn, current.plan_id);
      if (nextPlanId && nextPlanId !== current.plan_id) {
        await this.repo.syncPlanCompletionStatus(conn, nextPlanId);
      }

      return updated;
    });
  }

  async updateTaskPriority(
    userId: string,
    taskId: string,
    dto: UpdateTaskPriorityDto
  ): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');
    if (!dto.priority || !ALLOWED_TASK_PRIORITIES.includes(dto.priority)) {
      throw new BadRequestException(
        `Invalid priority; allowed values are ${ALLOWED_TASK_PRIORITIES.join(', ')}`
      );
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      if (current.status === 'cancelled') {
        throw new ConflictException('Cannot change priority of a cancelled task');
      }
      if (
        dto.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, current.updated_at)
      ) {
        throw new ConflictException('Conflicting priority update; task has been modified');
      }

      // PA-11: Update only priority while preserving all other task fields intact.
      return this.repo.updateTaskPriorityOnly(conn, id, dto.priority);
    });
  }

  async completeTask(
    userId: string,
    taskId: string,
    dto?: CompleteActionDto
  ): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      if (current.status === 'cancelled') {
        throw new ConflictException('Cannot complete a cancelled task');
      }

      // PA-12: Prevent duplicate completion updates from incrementing progress twice.
      if (current.status === 'completed') {
        const { deleted_at: _deleted, ...publicTask } = current;
        void _deleted;
        return {
          ...publicTask,
          already_completed: true,
        };
      }

      if (
        dto?.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, current.updated_at)
      ) {
        throw new ConflictException('Task was modified by another request');
      }

      const completed = await this.repo.markTaskCompleted(conn, id);
      if (completed.plan_id) {
        await this.repo.syncPlanCompletionStatus(conn, completed.plan_id);
      }
      return {
        ...completed,
        already_completed: false,
      };
    });
  }

  async reopenTask(
    userId: string,
    taskId: string,
    dto?: ReopenTaskDto
  ): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');
    const nextStatus = dto?.status ?? 'pending';
    if (nextStatus !== 'pending' && nextStatus !== 'in_progress') {
      throw new BadRequestException('Reopened task status must be pending or in_progress');
    }
    const nextProgress = dto?.progress_percent !== undefined ? Number(dto.progress_percent) : 0;
    if (!Number.isInteger(nextProgress) || nextProgress < 0 || nextProgress >= 100) {
      throw new BadRequestException('Reopened task progress_percent must be between 0 and 99');
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      if (current.status === 'cancelled') {
        throw new ConflictException('Cannot reopen a cancelled task');
      }

      if (current.status !== 'completed') {
        const { deleted_at: _deleted, ...publicTask } = current;
        void _deleted;
        return {
          ...publicTask,
          already_reopened: true,
        };
      }

      if (
        dto?.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, current.updated_at)
      ) {
        throw new ConflictException('Task was modified by another request');
      }

      const reopened = await this.repo.markTaskReopened(conn, id, nextStatus, nextProgress);
      if (reopened.plan_id) {
        await this.repo.syncPlanCompletionStatus(conn, reopened.plan_id);
      }
      return {
        ...reopened,
        already_reopened: false,
      };
    });
  }

  async cancelTask(
    userId: string,
    taskId: string,
    dto?: CancelTaskDto
  ): Promise<PersonalTaskRecord> {
    const id = assertBigintId(taskId, 'task id');

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      if (current.status === 'completed' || current.status === 'cancelled') {
        throw new ConflictException(`Cannot cancel a ${current.status} task`);
      }
      if (
        dto?.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, current.updated_at)
      ) {
        throw new ConflictException('Task was modified by another request');
      }

      const cancelled = await this.repo.markTaskCancelled(
        conn,
        id,
        dto?.reason?.trim() ? dto.reason.trim() : null
      );
      if (cancelled.plan_id) {
        await this.repo.syncPlanCompletionStatus(conn, cancelled.plan_id);
      }
      return cancelled;
    });
  }

  async deleteTask(userId: string, taskId: string): Promise<{ success: true; id: string }> {
    const id = assertBigintId(taskId, 'task id');

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findTaskByIdRaw(id, conn, true);
      if (!current || current.deleted_at) {
        throw new NotFoundException('Task was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Task does not belong to the authenticated user');
      }
      // Keep active child tasks intact while detaching them cleanly from the deleted parent.
      await this.repo.detachSubtasksOnParentDelete(conn, userId, id);
      await this.repo.softDeleteTask(conn, id);
      if (current.plan_id) {
        await this.repo.syncPlanCompletionStatus(conn, current.plan_id);
      }
      return { success: true, id };
    });
  }

  async resolveTaskReference(userId: string, reference: string): Promise<PersonalTaskRecord> {
    const trimmed = (reference ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Task reference must not be empty');
    }
    if (/^[1-9]\d{0,18}$/.test(trimmed)) {
      return this.getTask(userId, trimmed);
    }
    const matches = await this.repo.findTasksByTitleReference(userId, trimmed);
    if (matches.length === 0) {
      throw new NotFoundException(`No personal task matched reference "${trimmed}"`);
    }
    const exactMatches = matches.filter(
      (t) => t.title.toLowerCase() === trimmed.toLowerCase()
    );
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }
    if (matches.length > 1) {
      throw new ConflictException({
        message: 'Ambiguous task reference; multiple personal tasks matched',
        error: 'AMBIGUOUS_TASK_REFERENCE',
        candidates: matches.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_at: t.due_at,
        })),
      });
    }
    return matches[0];
  }

  async listPlans(userId: string, query: ListPlansQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const result = await this.repo.listPlans(userId, {
      page,
      limit,
      status: query.status,
    });
    return {
      ...result,
      page,
      limit,
      total_pages: Math.ceil(result.total / limit),
    };
  }

  async getPlan(userId: string, planId: string): Promise<PersonalPlanRecord> {
    const id = assertBigintId(planId, 'plan id');
    const row = await this.repo.findPlanByIdRaw(id);
    if (!row || row.deleted_at) {
      throw new NotFoundException('Personal plan was not found');
    }
    if (String(row.user_id) !== userId) {
      throw new ForbiddenException('Personal plan does not belong to the authenticated user');
    }
    return this.repo.buildPlanRecord(row);
  }

  async createPlan(userId: string, dto: CreatePlanDto): Promise<PersonalPlanRecord> {
    const title = (dto.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Plan title must not be empty');
    }
    const totalSessions = Number(dto.total_sessions);
    if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > 365) {
      throw new BadRequestException('total_sessions must be an integer between 1 and 365');
    }
    // Explicit steps are the PA-06 reviewed draft. Legacy session-count callers
    // retain their existing contract when sessions is omitted.
    if (dto.sessions !== undefined) {
      if (!Array.isArray(dto.sessions)) throw new BadRequestException('Plan steps must be an array');
      if (dto.confirmed !== true) throw new BadRequestException('Confirm the plan before saving');
      if (!dto.goal?.trim()) throw new BadRequestException('Plan goal must not be empty');
      if (!dto.sessions.length || dto.sessions.length !== totalSessions) {
        throw new BadRequestException('Explicit steps must match total_sessions');
      }
      const numbers = new Set<number>();
      for (const [index, step] of dto.sessions.entries()) {
        const number = step.session_number ?? index + 1;
        if (!step.title?.trim()) throw new BadRequestException('Plan step title must not be empty');
        if (!Number.isInteger(number) || number < 1 || number > totalSessions || numbers.has(number)) {
          throw new BadRequestException('Invalid or duplicate plan step number');
        }
        if (step.priority !== undefined && !ALLOWED_TASK_PRIORITIES.includes(step.priority)) {
          throw new BadRequestException('Invalid plan step priority');
        }
        parseOptionalDueAt(step.due_at);
        numbers.add(number);
      }
    }
    const startDate = parseOptionalDateOnly(dto.start_date, 'start_date');
    const endDate = parseOptionalDateOnly(dto.end_date, 'end_date');
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('start_date must be less than or equal to end_date');
    }

    return this.repo.withTransaction(async (conn) => {
      const planId = await this.repo.insertPlan(conn, {
        user_id: userId,
        title,
        description: dto.description?.trim() ? dto.description.trim() : null,
        goal: dto.goal?.trim() ? dto.goal.trim() : null,
        total_sessions: totalSessions,
        start_date: startDate,
        end_date: endDate,
      });

      // Seed sessions inside personal_tasks (using the approved 6-table architecture)
      if (Array.isArray(dto.sessions) && dto.sessions.length > 0) {
        if (dto.sessions.length > totalSessions) {
          throw new BadRequestException('Number of seeded sessions cannot exceed total_sessions');
        }
        const usedNumbers = new Set<number>();
        for (let i = 0; i < dto.sessions.length; i++) {
          const seed = dto.sessions[i];
          const sessionNumber = seed.session_number ?? i + 1;
          if (sessionNumber < 1 || sessionNumber > totalSessions || usedNumbers.has(sessionNumber)) {
            throw new BadRequestException(`Invalid or duplicate session_number ${sessionNumber}`);
          }
          usedNumbers.add(sessionNumber);
          await this.repo.insertTask(conn, {
            user_id: userId,
            plan_id: planId,
            session_number: sessionNumber,
            title: seed.title.trim(),
            description: seed.description?.trim() ? seed.description.trim() : null,
            status: 'pending',
            priority: seed.priority ?? 'MEDIUM',
            progress_percent: 0,
            due_at: parseOptionalDueAt(seed.due_at),
          });
        }
      } else {
        for (let sessionNumber = 1; sessionNumber <= totalSessions; sessionNumber++) {
          await this.repo.insertTask(conn, {
            user_id: userId,
            plan_id: planId,
            session_number: sessionNumber,
            title: `${title} — Buổi ${sessionNumber}`,
            description: null,
            status: 'pending',
            priority: 'MEDIUM',
            progress_percent: 0,
            due_at: null,
          });
        }
      }

      const planRow = await this.repo.findPlanByIdRaw(planId, conn);
      if (!planRow) throw new Error('Created plan could not be reloaded');
      return this.repo.buildPlanRecord(planRow, conn);
    });
  }

  async completePlanSession(
    userId: string,
    planId: string,
    sessionId: string,
    dto?: CompleteActionDto
  ): Promise<PersonalPlanRecord> {
    const pId = assertBigintId(planId, 'plan id');
    const sId = assertBigintId(sessionId, 'session id');

    return this.repo.withTransaction(async (conn) => {
      const planRow = await this.repo.findPlanByIdRaw(pId, conn, true);
      if (!planRow || planRow.deleted_at) {
        throw new NotFoundException('Personal plan was not found');
      }
      if (String(planRow.user_id) !== userId) {
        throw new ForbiddenException('Personal plan does not belong to the authenticated user');
      }

      const totalSessions = Math.max(1, Number(planRow.total_sessions ?? 1));

      // Match either personal_tasks.id === sId (belonging to plan pId) or session_number === Number(sId)
      let sessionTask = await this.repo.findTaskByIdRaw(sId, conn, true);
      if (sessionTask?.deleted_at && sessionTask.plan_id === pId && sessionTask.user_id === userId) {
        throw new NotFoundException('Plan step has been deleted');
      }
      if (
        !sessionTask ||
        sessionTask.deleted_at ||
        sessionTask.plan_id !== pId ||
        sessionTask.user_id !== userId
      ) {
        sessionTask = null;
        const numericSession = Number(sId);
        if (Number.isInteger(numericSession) && numericSession >= 1 && numericSession <= totalSessions) {
          const byNum = await this.repo.findSessionTaskByPlanAndNumber(
            pId,
            numericSession,
            conn,
            true
          );
          if (byNum) {
            sessionTask = { ...byNum, deleted_at: null };
          } else {
            // Create the completed session task row in personal_tasks
            await this.repo.insertTask(conn, {
              user_id: userId,
              plan_id: pId,
              session_number: numericSession,
              title: `${String(planRow.title)} — Buổi ${numericSession}`,
              description: null,
              status: 'completed',
              priority: 'MEDIUM',
              progress_percent: 100,
              due_at: null,
              completed_at: new Date(),
            });
            await this.repo.syncPlanCompletionStatus(conn, pId);
            const refreshedPlan = await this.repo.findPlanByIdRaw(pId, conn);
            const built = await this.repo.buildPlanRecord(refreshedPlan!, conn);
            return { ...built, already_completed: false };
          }
        }
      }

      if (!sessionTask) {
        throw new NotFoundException('Session was not found in this personal plan');
      }
      if (sessionTask.status === 'cancelled') {
        throw new ConflictException('Cannot complete a cancelled plan session');
      }

      // PA-12 rule: Prevent duplicate completion from increasing progress twice.
      if (sessionTask.status === 'completed') {
        const built = await this.repo.buildPlanRecord(planRow, conn);
        return { ...built, already_completed: true };
      }

      if (
        dto?.expected_updated_at &&
        !timestampsMatch(dto.expected_updated_at, String(planRow.updated_at instanceof Date ? planRow.updated_at.toISOString() : planRow.updated_at))
      ) {
        throw new ConflictException('Personal plan was modified by another request');
      }

      await this.repo.markTaskCompleted(conn, sessionTask.id);
      await this.repo.syncPlanCompletionStatus(conn, pId);
      const refreshedPlan = await this.repo.findPlanByIdRaw(pId, conn);
      const built = await this.repo.buildPlanRecord(refreshedPlan!, conn);
      return { ...built, already_completed: false };
    });
  }

  // =========================================================================
  // Personal schedule events.
  // =========================================================================

  async listEvents(userId: string, query: ListEventsQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    if (query.plan_id) assertBigintId(query.plan_id, 'plan_id');
    const fromDate = query.from ? parseOptionalDueAt(query.from) : null;
    const toDate = query.to ? parseOptionalDueAt(query.to) : null;
    const result = await this.repo.listEvents(userId, {
      page,
      limit,
      search: query.search,
      status: query.status,
      plan_id: query.plan_id,
      from: fromDate,
      to: toDate,
    });
    return {
      ...result,
      page,
      limit,
      total_pages: Math.ceil(result.total / limit),
    };
  }

  async getEvent(userId: string, eventId: string): Promise<PersonalEventRecord> {
    const id = assertBigintId(eventId, 'event id');
    const row = await this.repo.findEventByIdRaw(id);
    if (!row) {
      throw new NotFoundException('Personal event was not found');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Personal event does not belong to the authenticated user');
    }
    return row;
  }

  async createEvent(userId: string, dto: CreateEventDto): Promise<PersonalEventRecord> {
    const title = (dto.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Event title must not be empty');
    }
    const startAt = parseOptionalDueAt(dto.start_at);
    if (!startAt) {
      throw new BadRequestException('start_at is required and must be a valid datetime');
    }
    const endAt = parseOptionalDueAt(dto.end_at);
    if (endAt && endAt.getTime() < startAt.getTime()) {
      throw new BadRequestException('end_at must be after start_at');
    }
    const description = dto.description?.trim() ? dto.description.trim() : null;
    const location = dto.location?.trim() ? dto.location.trim() : null;
    const planId = dto.plan_id ? assertBigintId(dto.plan_id, 'plan_id') : null;

    return this.repo.withTransaction(async (conn) => {
      if (planId) {
        const plan = await this.repo.findPlanByIdRaw(planId, conn, true);
        if (!plan || plan.deleted_at) {
          throw new NotFoundException('Associated personal plan was not found');
        }
        if (String(plan.user_id) !== userId) {
          throw new ForbiddenException('Personal plan does not belong to the authenticated user');
        }
      }
      return this.repo.insertEvent(conn, {
        user_id: userId,
        plan_id: planId,
        title,
        description,
        location,
        start_at: startAt,
        end_at: endAt,
      });
    });
  }

  async updateEvent(
    userId: string,
    eventId: string,
    dto: UpdateEventDto
  ): Promise<PersonalEventRecord> {
    const id = assertBigintId(eventId, 'event id');
    if (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.location === undefined &&
      dto.start_at === undefined &&
      dto.end_at === undefined &&
      dto.status === undefined &&
      dto.plan_id === undefined
    ) {
      throw new BadRequestException('At least one event field must be provided for update');
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findEventByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal event was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal event does not belong to the authenticated user');
      }

      const nextTitle = dto.title !== undefined ? dto.title.trim() : current.title;
      if (!nextTitle) {
        throw new BadRequestException('Event title must not be empty');
      }
      const nextDescription =
        dto.description !== undefined
          ? dto.description?.trim()
            ? dto.description.trim()
            : null
          : current.description;
      const nextLocation =
        dto.location !== undefined
          ? dto.location?.trim()
            ? dto.location.trim()
            : null
          : current.location;
      const nextStartAt =
        dto.start_at !== undefined
          ? parseOptionalDueAt(dto.start_at)
          : parseOptionalDueAt(current.start_at);
      if (!nextStartAt) {
        throw new BadRequestException('start_at must be a valid datetime');
      }
      const nextEndAt =
        dto.end_at !== undefined
          ? parseOptionalDueAt(dto.end_at)
          : parseOptionalDueAt(current.end_at);
      if (nextEndAt && nextEndAt.getTime() < nextStartAt.getTime()) {
        throw new BadRequestException('end_at must be after start_at');
      }
      const nextStatus: EventStatus = dto.status ?? current.status;
      if (!ALLOWED_EVENT_STATUSES.includes(nextStatus)) {
        throw new BadRequestException(
          `Invalid event status; allowed values are ${ALLOWED_EVENT_STATUSES.join(', ')}`
        );
      }
      const nextPlanId =
        dto.plan_id !== undefined
          ? dto.plan_id
            ? assertBigintId(dto.plan_id, 'plan_id')
            : null
          : current.plan_id;

      if (nextPlanId) {
        const plan = await this.repo.findPlanByIdRaw(nextPlanId, conn, true);
        if (!plan || plan.deleted_at) {
          throw new NotFoundException('Associated personal plan was not found');
        }
        if (String(plan.user_id) !== userId) {
          throw new ForbiddenException('Personal plan does not belong to the authenticated user');
        }
      }

      return this.repo.updateEventFields(conn, id, {
        title: nextTitle,
        description: nextDescription,
        location: nextLocation,
        start_at: nextStartAt,
        end_at: nextEndAt,
        status: nextStatus,
        plan_id: nextPlanId,
      });
    });
  }

  async deleteEvent(userId: string, eventId: string): Promise<{ success: true; id: string }> {
    const id = assertBigintId(eventId, 'event id');
    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findEventByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal event was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal event does not belong to the authenticated user');
      }
      await this.repo.deleteEventById(conn, id);
      return { success: true, id };
    });
  }

  // =========================================================================
  // Reminders and delivery history.
  // =========================================================================

  async listReminders(userId: string, query: ListRemindersQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    if (query.task_id) assertBigintId(query.task_id, 'task_id');
    if (query.event_id) assertBigintId(query.event_id, 'event_id');
    const result = await this.repo.listReminders(userId, {
      page,
      limit,
      status: query.status,
      channel: query.channel,
      task_id: query.task_id,
      event_id: query.event_id,
    });
    return {
      ...result,
      page,
      limit,
      total_pages: Math.ceil(result.total / limit),
    };
  }

  async getReminder(userId: string, reminderId: string): Promise<PersonalReminderRecord> {
    const id = assertBigintId(reminderId, 'reminder id');
    const row = await this.repo.findReminderByIdRaw(id);
    if (!row) {
      throw new NotFoundException('Personal reminder was not found');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Personal reminder does not belong to the authenticated user');
    }
    return row;
  }

  async createReminder(userId: string, dto: CreateReminderDto): Promise<PersonalReminderRecord> {
    const message = (dto.message ?? '').trim();
    if (!message) {
      throw new BadRequestException('Reminder message must not be empty');
    }
    const remindAt = parseOptionalDueAt(dto.remind_at);
    if (!remindAt) {
      throw new BadRequestException('remind_at is required and must be a valid datetime');
    }
    const channel: ReminderChannel = dto.channel ?? 'VOICE';
    if (!ALLOWED_REMINDER_CHANNELS.includes(channel)) {
      throw new BadRequestException(
        `Invalid reminder channel; allowed values are ${ALLOWED_REMINDER_CHANNELS.join(', ')}`
      );
    }
    const taskId = dto.task_id ? assertBigintId(dto.task_id, 'task_id') : null;
    const eventId = dto.event_id ? assertBigintId(dto.event_id, 'event_id') : null;
    const deviceId = dto.device_id ? assertBigintId(dto.device_id, 'device_id') : null;

    return this.repo.withTransaction(async (conn) => {
      if (taskId) {
        const task = await this.repo.findTaskByIdRaw(taskId, conn, true);
        if (!task || task.deleted_at) {
          throw new NotFoundException('Associated personal task was not found');
        }
        if (task.user_id !== userId) {
          throw new ForbiddenException('Personal task does not belong to the authenticated user');
        }
      }
      if (eventId) {
        const event = await this.repo.findEventByIdRaw(eventId, conn, true);
        if (!event) {
          throw new NotFoundException('Associated personal event was not found');
        }
        if (event.user_id !== userId) {
          throw new ForbiddenException('Personal event does not belong to the authenticated user');
        }
      }
      if (deviceId) {
        const owned = await this.repo.verifyUserDeviceOwnership(userId, deviceId, conn);
        if (!owned) {
          throw new ForbiddenException('Device does not belong to the authenticated user');
        }
      }
      return this.repo.insertReminder(conn, {
        user_id: userId,
        task_id: taskId,
        event_id: eventId,
        remind_at: remindAt,
        message,
        channel,
        device_id: deviceId,
      });
    });
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    dto: UpdateReminderDto
  ): Promise<PersonalReminderRecord> {
    const id = assertBigintId(reminderId, 'reminder id');
    if (
      dto.message === undefined &&
      dto.remind_at === undefined &&
      dto.channel === undefined &&
      dto.status === undefined &&
      dto.task_id === undefined &&
      dto.event_id === undefined
    ) {
      throw new BadRequestException('At least one reminder field must be provided for update');
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findReminderByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal reminder was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal reminder does not belong to the authenticated user');
      }

      const nextMessage = dto.message !== undefined ? dto.message.trim() : current.message;
      if (!nextMessage) {
        throw new BadRequestException('Reminder message must not be empty');
      }
      const nextRemindAt =
        dto.remind_at !== undefined
          ? parseOptionalDueAt(dto.remind_at)
          : parseOptionalDueAt(current.remind_at);
      if (!nextRemindAt) {
        throw new BadRequestException('remind_at must be a valid datetime');
      }
      const nextChannel: ReminderChannel = dto.channel ?? current.channel;
      if (!ALLOWED_REMINDER_CHANNELS.includes(nextChannel)) {
        throw new BadRequestException(
          `Invalid reminder channel; allowed values are ${ALLOWED_REMINDER_CHANNELS.join(', ')}`
        );
      }
      const nextStatus: ReminderStatus = dto.status ?? current.status;
      if (!ALLOWED_REMINDER_STATUSES.includes(nextStatus)) {
        throw new BadRequestException(
          `Invalid reminder status; allowed values are ${ALLOWED_REMINDER_STATUSES.join(', ')}`
        );
      }
      const nextTaskId =
        dto.task_id !== undefined
          ? dto.task_id
            ? assertBigintId(dto.task_id, 'task_id')
            : null
          : current.task_id;
      const nextEventId =
        dto.event_id !== undefined
          ? dto.event_id
            ? assertBigintId(dto.event_id, 'event_id')
            : null
          : current.event_id;

      if (nextTaskId) {
        const task = await this.repo.findTaskByIdRaw(nextTaskId, conn, true);
        if (!task || task.deleted_at) {
          throw new NotFoundException('Associated personal task was not found');
        }
        if (task.user_id !== userId) {
          throw new ForbiddenException('Personal task does not belong to the authenticated user');
        }
      }
      if (nextEventId) {
        const event = await this.repo.findEventByIdRaw(nextEventId, conn, true);
        if (!event) {
          throw new NotFoundException('Associated personal event was not found');
        }
        if (event.user_id !== userId) {
          throw new ForbiddenException('Personal event does not belong to the authenticated user');
        }
      }

      return this.repo.updateReminderFields(conn, id, {
        message: nextMessage,
        remind_at: nextRemindAt,
        channel: nextChannel,
        status: nextStatus,
        task_id: nextTaskId,
        event_id: nextEventId,
      });
    });
  }

  async acknowledgeReminder(
    userId: string,
    reminderId: string,
    dto?: AcknowledgeReminderDto
  ): Promise<PersonalReminderRecord> {
    const id = assertBigintId(reminderId, 'reminder id');
    const deviceId = dto?.device_id ? assertBigintId(dto.device_id, 'device_id') : null;

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findReminderByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal reminder was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal reminder does not belong to the authenticated user');
      }
      if (current.status === 'cancelled') {
        throw new ConflictException('Cannot acknowledge a cancelled reminder');
      }
      if (deviceId) {
        const owned = await this.repo.verifyUserDeviceOwnership(userId, deviceId, conn);
        if (!owned) {
          throw new ForbiddenException('Device does not belong to the authenticated user');
        }
      }
      return this.repo.acknowledgeReminder(
        conn,
        id,
        dto?.channel ?? current.channel,
        deviceId
      );
    });
  }

  async deleteReminder(
    userId: string,
    reminderId: string
  ): Promise<{ success: true; id: string }> {
    const id = assertBigintId(reminderId, 'reminder id');
    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findReminderByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal reminder was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal reminder does not belong to the authenticated user');
      }
      await this.repo.deleteReminderById(conn, id);
      return { success: true, id };
    });
  }

  // =========================================================================
  // Personal memories.
  // =========================================================================

  async listMemories(userId: string, query: ListMemoriesQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const result = await this.repo.listMemories(userId, {
      page,
      limit,
      search: query.search,
      category: query.category,
    });
    return {
      ...result,
      page,
      limit,
      total_pages: Math.ceil(result.total / limit),
    };
  }

  async getMemory(userId: string, memoryId: string): Promise<PersonalMemoryRecord> {
    const id = assertBigintId(memoryId, 'memory id');
    const row = await this.repo.findMemoryByIdRaw(id);
    if (!row) {
      throw new NotFoundException('Personal memory was not found');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Personal memory does not belong to the authenticated user');
    }
    return row;
  }

  async createMemory(userId: string, dto: CreateMemoryDto): Promise<PersonalMemoryRecord> {
    if (dto.consent !== true) throw new BadRequestException('Cần đồng ý trước khi lưu ghi nhớ cá nhân.');
    const memoryKey = (dto.memory_key ?? '').trim();
    const memoryValue = (dto.memory_value ?? '').trim();
    if (!memoryKey || !memoryValue) {
      throw new BadRequestException('memory_key and memory_value must not be empty');
    }
    const category = dto.category?.trim() ? dto.category.trim() : null;
    const confidence =
      dto.confidence !== undefined && dto.confidence !== null ? Number(dto.confidence) : null;
    if (confidence !== null && (Number.isNaN(confidence) || confidence < 0 || confidence > 1)) {
      throw new BadRequestException('confidence must be between 0 and 1');
    }
    const sourceConversationId = dto.source_conversation_id
      ? assertBigintId(dto.source_conversation_id, 'source_conversation_id')
      : null;

    return this.repo.withTransaction(async (conn) => {
      if (sourceConversationId) {
        const owned = await this.repo.verifyUserConversationOwnership(
          userId,
          sourceConversationId,
          conn
        );
        if (!owned) {
          throw new ForbiddenException('Conversation does not belong to the authenticated user');
        }
      }
      return this.repo.upsertMemory(conn, {
        user_id: userId,
        memory_key: memoryKey,
        memory_value: memoryValue,
        category,
        confidence,
        source_conversation_id: sourceConversationId,
      });
    });
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    dto: UpdateMemoryDto
  ): Promise<PersonalMemoryRecord> {
    if (dto.consent !== true) throw new BadRequestException('Cần đồng ý trước khi cập nhật ghi nhớ cá nhân.');
    const id = assertBigintId(memoryId, 'memory id');
    if (
      dto.memory_key === undefined &&
      dto.memory_value === undefined &&
      dto.category === undefined &&
      dto.confidence === undefined
    ) {
      throw new BadRequestException('At least one memory field must be provided for update');
    }

    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findMemoryByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal memory was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal memory does not belong to the authenticated user');
      }

      if (dto.expected_revision !== undefined && dto.expected_revision !== current.revision) {
        throw new ConflictException('Ghi nhớ đã thay đổi ở phiên khác. Tải lại bản mới trước khi lưu.');
      }

      const nextKey = dto.memory_key !== undefined ? dto.memory_key.trim() : current.memory_key;
      const nextValue =
        dto.memory_value !== undefined ? dto.memory_value.trim() : current.memory_value;
      if (!nextKey || !nextValue) {
        throw new BadRequestException('memory_key and memory_value must not be empty');
      }
      if (nextKey !== current.memory_key) {
        const duplicate = await this.repo.findMemoryByKey(userId, nextKey, conn, true);
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(`Memory key "${nextKey}" already exists`);
        }
      }
      const nextCategory =
        dto.category !== undefined
          ? dto.category?.trim()
            ? dto.category.trim()
            : null
          : current.category;
      const nextConfidence =
        dto.confidence !== undefined ? dto.confidence : current.confidence;
      if (
        nextConfidence !== null &&
        nextConfidence !== undefined &&
        (Number.isNaN(Number(nextConfidence)) || Number(nextConfidence) < 0 || Number(nextConfidence) > 1)
      ) {
        throw new BadRequestException('confidence must be between 0 and 1');
      }

      return this.repo.updateMemoryFields(conn, id, {
        memory_key: nextKey,
        memory_value: nextValue,
        category: nextCategory,
        confidence: nextConfidence === null || nextConfidence === undefined ? null : Number(nextConfidence),
      });
    });
  }

  async deleteMemory(
    userId: string,
    memoryId: string
  ): Promise<{ success: true; id: string }> {
    const id = assertBigintId(memoryId, 'memory id');
    return this.repo.withTransaction(async (conn) => {
      const current = await this.repo.findMemoryByIdRaw(id, conn, true);
      if (!current) {
        throw new NotFoundException('Personal memory was not found');
      }
      if (current.user_id !== userId) {
        throw new ForbiddenException('Personal memory does not belong to the authenticated user');
      }
      await this.repo.deleteMemoryById(conn, id);
      return { success: true, id };
    });
  }
}
