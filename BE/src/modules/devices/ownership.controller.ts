import { Body, Controller, Get, Header, Param, Patch, Post, HttpCode, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { InternalDeviceGuard } from './internal-device.guard';
import { OwnershipService } from './ownership.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('user/devices')
@UseGuards(UserPairingGuard)
export class UserDevicesController {
  constructor(private readonly ownership:OwnershipService) {}
  @Get()
  list(@Req() req:AuthenticatedRequest){return this.ownership.getUserDevices(req.currentUser);}
  @Get(':id')
  detail(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.ownership.verifyDeviceOwnership(req.currentUser,id);}
  @Patch(':id')
  rename(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() body:unknown){
    return this.ownership.renameUserDevice(req.currentUser,id,body);
  }
}

@Controller('user/dashboard')
@UseGuards(UserPairingGuard)
export class DashboardAccessController {
  constructor(private readonly ownership:OwnershipService) {}
  @Get('access')
  access(@Req() req:AuthenticatedRequest){return this.ownership.canAccessDashboard(req.currentUser);}
}

@Controller('internal/devices')
@Public()
@UseGuards(InternalDeviceGuard)
export class InternalDevicesController {
  constructor(private readonly ownership:OwnershipService) {}
  @Post('authorize')
  @HttpCode(200)
  authorize(@Body() body:unknown){return this.ownership.authorizeDeviceConnection(body);}
  @Post('personal-memory')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  personalMemory(@Body() body: unknown) { return this.ownership.personalMemory(body); }
  @Post('reminder-receipt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reminderReceipt(@Body() body: unknown) { return this.ownership.reminderReceipt(body); }
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Body() body:unknown){return this.ownership.recordDeviceHeartbeat(body);}
}
