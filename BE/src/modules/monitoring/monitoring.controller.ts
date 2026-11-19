import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MonitoringService } from './monitoring.service';

class HeartbeatDto {
  @IsString() instance_code!: string;
  @IsOptional() @IsIn(['online', 'offline', 'degraded', 'starting', 'stopped']) status?: string;
  @IsOptional() @IsString() started_at?: string;
}
class MetricsDto {
  @IsOptional() @IsNumber() cpu_percent?: number;
  @IsOptional() @IsNumber() memory_percent?: number;
  @IsOptional() @IsNumber() gpu_percent?: number;
  @IsOptional() @IsNumber() gpu_memory_percent?: number;
  @IsOptional() @IsInt() @Min(0) active_sessions?: number;
  @IsOptional() @IsString() recorded_at?: string;
}

@ApiTags('monitoring')
@Controller('admin')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}
  @Get('dashboard') @Roles('ADMIN') dashboard() { return this.service.dashboard(); }
  @Get('monitoring/instances') @Roles('ADMIN') instances() { return this.service.instances(); }
  @Get('monitoring/instances/:id/metrics') @Roles('ADMIN') instanceMetrics(@Param('id') id: string, @Query('limit') limit?: string) {
    if (!/^[1-9][0-9]{0,18}$/.test(id)) throw new BadRequestException('Invalid instance ID');
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new BadRequestException('Invalid limit');
    return this.service.instanceMetrics(id, parsedLimit);
  }
  @Post('monitoring/instances/heartbeat') @Roles('ADMIN') heartbeat(@Body() dto: HeartbeatDto) { return this.service.heartbeat(dto as unknown as Record<string, unknown>); }
  @Post('monitoring/instances/:id/metrics') @Roles('ADMIN') metrics(@Param('id') id: string, @Body() dto: MetricsDto) { return this.service.metrics(id, dto as unknown as Record<string, unknown>); }
}
