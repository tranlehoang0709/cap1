import { Body,Controller,Get,Headers,HttpCode,Param,Post,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { RecoveryService } from './recovery.service';
import { ResetSourceGuard } from './reset-source.guard';

@Controller('admin') @UseGuards(AdminDeviceGuard)
export class RecoveryController {
  constructor(private readonly recovery:RecoveryService){}
  @Post('devices/:id/revoke') @HttpCode(202)
  revoke(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.recovery.revokeDeviceAssignment(req.currentUser,id,body,key);}
  @Get('devices/:id/recovery')
  recoveryMetadata(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.recovery.getRecovery(req.currentUser,id);}
  @Get('devices/:id/reset-status')
  status(@Req() req:AuthenticatedRequest,@Param('id') id:string){return this.recovery.getResetStatus(req.currentUser,id);}
  @Post('device-recovery/:backupId/restore') @HttpCode(200)
  restore(@Req() req:AuthenticatedRequest,@Param('backupId') id:string){return this.recovery.restoreDeviceAssignment(req.currentUser,id);}
}
@Controller('internal/device-reset-jobs') @UseGuards(ResetSourceGuard)
export class InternalResetController {
  constructor(private readonly recovery:RecoveryService){}
  @Post('claim') @HttpCode(200)
  claim(@Body() body:unknown){return this.recovery.requestDeviceReset(body);}
  @Post(':id/ack') @HttpCode(200)
  acknowledge(@Param('id') id:string,@Body() body:unknown){return this.recovery.processResetAcknowledgment(id,body);}
}
