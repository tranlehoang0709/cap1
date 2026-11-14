import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ALLOWED_TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type TaskPriority = (typeof ALLOWED_TASK_PRIORITIES)[number];

export const ALLOWED_TASK_SORT_MODES = ['default', 'priority_desc', 'priority_asc'] as const;
export type TaskSortMode = (typeof ALLOWED_TASK_SORT_MODES)[number];

export const ALLOWED_TASK_STATUSES = [
  'pending',
  'in_progress',
  'partial',
  'completed',
  'cancelled',
] as const;
export type TaskStatus = (typeof ALLOWED_TASK_STATUSES)[number];

export const ALLOWED_PLAN_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const;
export type PlanStatus = (typeof ALLOWED_PLAN_STATUSES)[number];

export const ALLOWED_EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type EventStatus = (typeof ALLOWED_EVENT_STATUSES)[number];

export const ALLOWED_REMINDER_CHANNELS = ['VOICE', 'WEB', 'BOTH'] as const;
export type ReminderChannel = (typeof ALLOWED_REMINDER_CHANNELS)[number];

export const ALLOWED_REMINDER_STATUSES = [
  'pending',
  'delivered',
  'acknowledged',
  'cancelled',
] as const;
export type ReminderStatus = (typeof ALLOWED_REMINDER_STATUSES)[number];

export class ListTasksQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_TASK_STATUSES)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_PRIORITIES })
  @IsOptional()
  @IsIn(ALLOWED_TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  parent_task_id?: string;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_SORT_MODES, default: 'default' })
  @IsOptional()
  @IsIn(ALLOWED_TASK_SORT_MODES)
  sort_by?: TaskSortMode;
}

export class CreateTaskDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  due_at?: string | null;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_PRIORITIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(ALLOWED_TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  event_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  parent_task_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  session_number?: number | null;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  due_at?: string | null;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_PRIORITIES })
  @IsOptional()
  @IsIn(ALLOWED_TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: ['pending', 'in_progress', 'partial'] })
  @IsOptional()
  @IsIn(['pending', 'in_progress', 'partial'])
  status?: 'pending' | 'in_progress' | 'partial';

  @ApiPropertyOptional({ minimum: 0, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  progress_percent?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  event_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  parent_task_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  session_number?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_updated_at?: string;
}

export class UpdateTaskPriorityDto {
  @ApiProperty({ enum: ALLOWED_TASK_PRIORITIES })
  @IsIn(ALLOWED_TASK_PRIORITIES)
  priority!: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_updated_at?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  due_at?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  session_number?: number | null;
}

export class CompleteActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_updated_at?: string;
}

export class ReopenTaskDto {
  @ApiPropertyOptional({ enum: ['pending', 'in_progress'], default: 'pending' })
  @IsOptional()
  @IsIn(['pending', 'in_progress'])
  status?: 'pending' | 'in_progress';

  @ApiPropertyOptional({ minimum: 0, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  progress_percent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_updated_at?: string;
}

export class CancelTaskDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_updated_at?: string;
}

export class ResolveTaskReferenceDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reference!: string;
}

export class ListPlansQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: ALLOWED_PLAN_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_PLAN_STATUSES)
  status?: PlanStatus;
}

export class CreatePlanSessionSeedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  session_number?: number;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: ALLOWED_TASK_PRIORITIES })
  @IsOptional()
  @IsIn(ALLOWED_TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  due_at?: string | null;
}

export class CreatePlanDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  goal?: string | null;

  @ApiProperty({ minimum: 1, maximum: 365, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  total_sessions!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  start_date?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  end_date?: string | null;

  @ApiPropertyOptional({ type: [CreatePlanSessionSeedDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanSessionSeedDto)
  sessions?: CreatePlanSessionSeedDto[];
}

export class ListEventsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ALLOWED_EVENT_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_EVENT_STATUSES)
  status?: EventStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  to?: string;
}

export class CreateEventDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  start_at!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  end_at?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string | null;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  start_at?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  end_at?: string | null;

  @ApiPropertyOptional({ enum: ALLOWED_EVENT_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_EVENT_STATUSES)
  status?: EventStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  plan_id?: string | null;
}

export class ListRemindersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_STATUSES)
  status?: ReminderStatus;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_CHANNELS })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_CHANNELS)
  channel?: ReminderChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  task_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  event_id?: string;
}

export class CreateReminderDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  remind_at!: string;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_CHANNELS, default: 'VOICE' })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_CHANNELS)
  channel?: ReminderChannel;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  task_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  event_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  device_id?: string | null;
}

export class UpdateReminderDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  remind_at?: string;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_CHANNELS })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_CHANNELS)
  channel?: ReminderChannel;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_STATUSES })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_STATUSES)
  status?: ReminderStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  task_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  event_id?: string | null;
}

export class AcknowledgeReminderDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  device_id?: string | null;

  @ApiPropertyOptional({ enum: ALLOWED_REMINDER_CHANNELS })
  @IsOptional()
  @IsIn(ALLOWED_REMINDER_CHANNELS)
  channel?: ReminderChannel;
}

export class ListMemoriesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

export class CreateMemoryDto {
  @ApiProperty({ description: 'Explicit consent to store this memory' })
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  consent!: boolean;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  memory_key!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  memory_value!: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  source_conversation_id?: string | null;
}

export class UpdateMemoryDto {
  @ApiProperty({ description: 'Explicit consent to store the updated memory' })
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  consent!: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  memory_key?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  memory_value?: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number | null;
}
