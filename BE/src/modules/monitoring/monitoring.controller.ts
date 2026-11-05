import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { MonitoringService } from './monitoring.service';

class InstanceHeartbeatDto {
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
  @Post('monitoring/instances/heartbeat') @Roles('ADMIN') heartbeat(@Body() dto: InstanceHeartbeatDto) { return this.service.heartbeat(dto as unknown as Record<string, unknown>); }
  @Post('monitoring/instances/:id/metrics') @Roles('ADMIN') metrics(@Param('id') id: string, @Body() dto: MetricsDto) { return this.service.metrics(id, dto as unknown as Record<string, unknown>); }
}

@Controller('internal/devices')
@Public()
@UseGuards(InternalDeviceGuard)
export class HeartbeatController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Post('heartbeat') @HttpCode(200)
  heartbeat(@Body() body: unknown) { return this.monitoring.processHeartbeat(body); }
}
@Controller('admin/devices')
@Public()
@UseGuards(AdminDeviceGuard)
export class AdminMonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get(':id/monitoring')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.monitoring.getDeviceMonitoring(req.currentUser,id); }
}
@Controller('user/devices')
@Public()
@UseGuards(UserPairingGuard)
export class UserMonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get(':id/monitoring')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.monitoring.getDeviceMonitoring(req.currentUser,id); }
}
