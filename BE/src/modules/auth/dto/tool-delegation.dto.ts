import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class ToolDelegationDto {
  @IsIn(['schedule.query'])
  scope!: 'schedule.query';

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  session_id!: string;
}
