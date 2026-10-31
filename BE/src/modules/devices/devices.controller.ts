import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminDeviceGuard } from './admin-device.guard';
import { DevicesService } from './devices.service';

@Controller('admin/devices')
@UseGuards(AdminDeviceGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) { return this.devices.list(query); }

  @Get(':deviceId')
  detail(@Param('deviceId') id: string) { return this.devices.detail(id); }
}
