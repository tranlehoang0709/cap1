import { IsBoolean, IsDateString, IsISO8601, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ToolDelegatedEventDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsDateString() starts_at!: string;
  @IsDateString() ends_at!: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(500) recurrence_rule?: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
  @IsString() @MinLength(1) @MaxLength(128) idempotency_key!: string;
  @IsString() @MinLength(32) @MaxLength(256) confirmation_proof!: string;
}
export class ToolDelegatedDeleteDto {
  @IsString() @MinLength(1) event_id!: string;
  @IsString() @MinLength(1) @MaxLength(128) idempotency_key!: string;
  @IsString() @MinLength(32) @MaxLength(256) confirmation_proof!: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
}

export class ToolDelegatedEventQueryDto {
  @IsString() @MinLength(1) @MaxLength(128) session_id!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) device_id?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() event_id?: string;
  @IsIn(['event.query', 'event.check_conflict', 'event.create', 'event.update', 'event.delete'])
  scope!: 'event.query' | 'event.check_conflict' | 'event.create' | 'event.update' | 'event.delete';
}

export class ToolDelegationQueryDto {
  @IsString() @MinLength(1) @MaxLength(128)
  session_id!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128)
  device_id?: string;
  @IsOptional() @IsISO8601()
  from?: string;
  @IsOptional() @IsISO8601()
  to?: string;
}

export class ToolAssistantQueryDto extends ToolDelegationQueryDto {
  @IsOptional() @IsIn(['date', 'overdue', 'incomplete'])
  mode?: 'date' | 'overdue' | 'incomplete';
  @IsOptional() @IsBoolean()
  include_events?: boolean;
  @IsOptional() @IsBoolean()
  include_tasks?: boolean;
}
