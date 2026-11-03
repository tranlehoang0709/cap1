import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) device_uid!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) display_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) hardware_model?: string;
}
export class RenameDeviceDto { @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) display_name!: string; }
export class PairingCodeDto { @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 60 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) ttl_minutes = 10; }
export class PairDeviceDto { @ApiProperty() @IsString() @MinLength(32) @MaxLength(64) pairing_code!: string; }
export class ReviewPairingDto { @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string; }
export class PageQueryDto { @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1; @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20; }
export class HeartbeatDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) battery_percent?: number;
  @ApiPropertyOptional({ minimum: -127, maximum: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(-127) @Max(0) wifi_rssi?: number;
  @ApiPropertyOptional({ description: 'Unsigned integer string, to preserve BIGINT precision' }) @IsOptional() @IsString() @MaxLength(20) free_heap_bytes?: string;
}
