import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class DeviceToolDelegationDto {
  @IsString() @MinLength(1) @MaxLength(128)
  device_uid!: string;
  @IsString() @MinLength(43) @MaxLength(128)
  credential!: string;
  @IsString() @MinLength(1) @MaxLength(128)
  session_id!: string;
  @IsString() @MinLength(16) @MaxLength(128)
  proof_nonce!: string;
  @IsIn(['schedule.query', 'event.query', 'event.check_conflict', 'event.create', 'event.update', 'event.delete'])
  scope!: 'schedule.query' | 'event.query' | 'event.check_conflict' | 'event.create' | 'event.update' | 'event.delete';
}
