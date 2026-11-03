import{Controller,Get}from'@nestjs/common';import{ApiTags}from'@nestjs/swagger';import{Roles}from'../../common/decorators/roles.decorator';import{MonitoringService}from'./monitoring.service';@ApiTags('monitoring')@Controller('admin')export class MonitoringController{constructor(private s:MonitoringService){}@Get('dashboard')@Roles('ADMIN')dashboard(){return this.s.dashboard()}@Get('monitoring/instances')@Roles('ADMIN')instances(){return this.s.instances()}}
import { Body, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AuthenticatedRequest } from '../auth/access-role.guard';

@Controller('internal/devices') @Public() @UseGuards(InternalDeviceGuard)
export class HeartbeatController {
  constructor(private readonly service:MonitoringService){}
  @Post('heartbeat') @HttpCode(200) heartbeat(@Body() body:unknown){return this.service.processHeartbeat(body);}
}
@Controller('admin/devices') @Public() @UseGuards(AdminDeviceGuard)
export class AdminMonitoringController {
  constructor(private readonly service:MonitoringService){}
  @Get(':id/monitoring') get(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.service.getDeviceMonitoring(req.currentUser,id);}
}
@Controller('user/devices') @Public() @UseGuards(UserPairingGuard)
export class UserMonitoringController {
  constructor(private readonly service:MonitoringService){}
  @Get(':id/monitoring') get(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.service.getDeviceMonitoring(req.currentUser,id);}
}
