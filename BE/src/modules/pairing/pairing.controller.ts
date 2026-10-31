import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { PairingService } from './pairing.service';
import { UserPairingGuard } from './user-pairing.guard';

@Controller('user/devices/pairing-requests')
@UseGuards(UserPairingGuard)
export class UserPairingController {
  constructor(private readonly pairing: PairingService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.pairing.createPairingRequest(request.currentUser, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.pairing.listPairingRequests(request.currentUser, query);
  }
}

@Controller('admin/pairing-requests')
@UseGuards(AdminDeviceGuard)
export class AdminPairingController {
  constructor(private readonly pairing: PairingService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.pairing.listPairingRequests(request.currentUser, query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.pairing.approvePairing(id, request.currentUser, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.pairing.rejectPairing(id, request.currentUser, body);
  }
}
