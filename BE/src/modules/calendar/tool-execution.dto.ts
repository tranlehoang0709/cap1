import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ToolDelegationQueryDto {
  @IsString() @MinLength(1) @MaxLength(128)
  session_id!: string;
  @IsOptional() @IsISO8601()
  from?: string;
  @IsOptional() @IsISO8601()
  to?: string;
}
