import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ToolDelegationDto {
  @IsIn(['schedule.query', 'event.query', 'event.check_conflict', 'event.create', 'event.update', 'event.delete'])
  scope!: 'schedule.query' | 'event.query' | 'event.check_conflict' | 'event.create' | 'event.update' | 'event.delete';

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  session_id!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128)
  device_id?: string;
}
