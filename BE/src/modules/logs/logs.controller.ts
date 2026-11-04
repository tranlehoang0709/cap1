import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { LogsService } from './logs.service';

class LogIngestDto {
  @IsOptional() @IsInt() @Min(1) instance_id?: number;
  @IsOptional() @IsInt() @Min(1) device_id?: number;
  @IsIn(['debug', 'info', 'warn', 'error', 'critical']) severity!: string;
  @IsString() component!: string;
  @IsOptional() @IsString() event_code?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() occurred_at?: string;
}

@ApiTags('logs')
@Controller('admin')
export class LogsController {
  constructor(private readonly service: LogsService) {}
  @Post('logs') @Roles('ADMIN') ingest(@Body() dto: LogIngestDto) { return this.service.ingest(dto as unknown as Record<string, unknown>); }
  @Get('logs') @Roles('ADMIN') system(@Query('page') page = '1', @Query('limit') limit = '50', @Query('severity') severity?: string, @Query('component') component?: string) { const p = Math.max(1, +page), l = Math.min(100, Math.max(1, +limit)); return this.service.system(p, l, severity, component); }
  @Get('audit-logs') @Roles('ADMIN') audit(@Query('page') page = '1', @Query('limit') limit = '50') { const p = Math.max(1, +page), l = Math.min(100, Math.max(1, +limit)); return this.service.audit(p, l); }
}
