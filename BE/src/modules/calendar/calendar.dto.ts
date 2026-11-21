import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCalendarEventDto {
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(1) @MaxLength(255)
  title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000)
  description?: string;
  @ApiProperty({ description: 'ISO-8601 instant or offset date-time' }) @IsDateString()
  starts_at!: string;
  @ApiProperty({ description: 'ISO-8601 instant or offset date-time' }) @IsDateString()
  ends_at!: string;
  @ApiPropertyOptional({ default: 'UTC' }) @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;
  @ApiPropertyOptional({ description: 'RFC 5545 recurrence rule, for example FREQ=WEEKLY;BYDAY=MO' }) @IsOptional() @IsString() @MaxLength(500)
  recurrence_rule?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean()
  confirm_conflict?: boolean;
}

export class UpdateCalendarEventDto extends PartialType(CreateCalendarEventDto) {}

export class CalendarEventQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  to?: string;
}

export class CreateReminderDto {
  @ApiProperty({ maxLength: 500 }) @IsString() @MinLength(1) @MaxLength(500)
  message!: string;
  @ApiProperty({ description: 'ISO-8601 instant at which the reminder should be delivered' }) @IsDateString()
  remind_at!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()
  calendar_event_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()
  device_id?: string;
}

export class ReminderQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  status?: string;
}

export class ReminderAckDto {
  @ApiProperty({ enum: ['delivered', 'failed'] }) @IsIn(['delivered', 'failed'])
  result!: 'delivered' | 'failed';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  failure_code?: string;
}

export class DueReminderQueryDto {
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @IsInt() @Min(1)
  limit?: number;
}
