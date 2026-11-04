import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeviceAuth } from '../../common/decorators/device-auth.decorator';
import { DevicePrincipal } from '../../common/decorators/device-principal.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { DevicesService } from './devices.service';
import { HeartbeatDto, PageQueryDto, PairDeviceDto, PairingCodeDto, RegisterDeviceDto, RenameDeviceDto, ReviewPairingDto } from './dto/devices.dto';
import { DevicePrincipal as DeviceIdentity } from './devices.types';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get() @ApiOperation({ summary: 'List caller-owned devices; Admin uses /devices/admin/all' })
  async listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: PageQueryDto) {
    return this.page(await this.devices.list(user.id, query.page, query.limit), query);
  }
  @Get(':id') @ApiOperation({ summary: 'Read one caller-owned device' }) getMine(@CurrentUser() user: AuthenticatedUser,@Param('id')id:string){return this.devices.getOwned(user.id,id);}

  @Patch(':id') @ApiOperation({ summary: 'Rename caller-owned device' })
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RenameDeviceDto) { return this.devices.rename(user.id, id, dto.display_name); }

  @Delete(':id/assignment') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Unlink caller-owned device and revoke device credentials' })
  unlink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.devices.unlink(user.id, id); }

  @Post('pairing-requests') @ApiOperation({ summary: 'Create a pairing request from one-time pairing code' })
  requestPairing(@CurrentUser() user: AuthenticatedUser, @Body() dto: PairDeviceDto) { return this.devices.requestPairing(user.id, dto.pairing_code); }

  @Get('pairing-requests/mine') @ApiOperation({ summary: 'List caller pairing requests' })
  async pairingRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: PageQueryDto) { return this.page(await this.devices.listRequests(user.id, query.page, query.limit), query); }

  @Post('admin') @Roles('ADMIN') @ApiOperation({ summary: 'Register a physical device (Admin)' })
  register(@Body() dto: RegisterDeviceDto) { return this.devices.register(dto.device_uid, dto.display_name, dto.hardware_model); }

  @Get('admin/all') @Roles('ADMIN') @ApiOperation({ summary: 'List all devices (Admin)' })
  async listAll(@Query() query: PageQueryDto) { return this.page(await this.devices.list(null, query.page, query.limit), query); }

  @Post('admin/:id/pairing-codes') @Roles('ADMIN') @ApiOperation({ summary: 'Issue a one-time pairing code (Admin); plaintext is returned once' })
  code(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body() dto: PairingCodeDto) { return this.devices.createPairingCode(admin.id, id, dto.ttl_minutes); }

  @Post('admin/:id/credential') @Roles('ADMIN') @ApiOperation({ summary: 'Issue and rotate device credential (Admin); plaintext is returned once' })
  credential(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) { return this.devices.issueCredential(admin.id, id); }

  @Get('admin/pairing-requests') @Roles('ADMIN') @ApiOperation({ summary: 'List all pairing requests (Admin)' })
  async listPairingRequests(@Query() query: PageQueryDto) { return this.page(await this.devices.listRequests(null, query.page, query.limit), query); }

  @Post('admin/pairing-requests/:id/approve') @Roles('ADMIN') @ApiOperation({ summary: 'Approve pairing request and assign device (Admin)' })
  approve(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewPairingDto) { return this.devices.reviewPairing(admin.id, id, true, dto.note); }

  @Post('admin/pairing-requests/:id/reject') @Roles('ADMIN') @ApiOperation({ summary: 'Reject pairing request (Admin)' })
  reject(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewPairingDto) { return this.devices.reviewPairing(admin.id, id, false, dto.note); }

  @DeviceAuth() @Get('device/me') @ApiOperation({ summary: 'Verify device credential and return device identity' })
  me(@DevicePrincipal() device: DeviceIdentity) { return { device_id: device.deviceId, device_uid: device.deviceUid }; }

  @DeviceAuth() @Post('device/heartbeat') @ApiOperation({ summary: 'Record authenticated device heartbeat' })
  heartbeat(@DevicePrincipal() device: DeviceIdentity, @Body() dto: HeartbeatDto) { return this.devices.heartbeat(device, dto.battery_percent, dto.wifi_rssi, dto.free_heap_bytes); }

  private page<T>(result: { items: T[]; total: number }, query: PageQueryDto) { return { ...result, page: query.page, limit: query.limit, total_pages: Math.ceil(result.total / query.limit) }; }
}
