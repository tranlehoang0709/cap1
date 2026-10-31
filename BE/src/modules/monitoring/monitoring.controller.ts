import { Body,Controller,Get,HttpCode,Param,Post,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { MonitoringService } from './monitoring.service';

@Controller('internal/devices')
@UseGuards(InternalDeviceGuard)
export class HeartbeatController {
  constructor(private readonly monitoring:MonitoringService){}
  @Post('heartbeat') @HttpCode(200)
  heartbeat(@Body() body:unknown){return this.monitoring.processHeartbeat(body);}
}
@Controller('admin/devices')
@UseGuards(AdminDeviceGuard)
export class AdminMonitoringController {
  constructor(private readonly monitoring:MonitoringService){}
  @Get(':id/monitoring')
  read(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.monitoring.getDeviceMonitoring(req.currentUser,id);}
}
@Controller('user/devices')
@UseGuards(UserPairingGuard)
export class UserMonitoringController {
  constructor(private readonly monitoring:MonitoringService){}
  @Get(':id/monitoring')
  read(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.monitoring.getDeviceMonitoring(req.currentUser,id);}
}
