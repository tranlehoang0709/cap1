import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { InternalDevicesController } from './ownership.controller';
import { OwnershipRepository } from './ownership.repository';
import { OwnershipService } from './ownership.service';
import { InternalDeviceGuard } from './internal-device.guard';

@Module({ imports: [DatabaseModule], controllers: [DevicesController, InternalDevicesController],
  providers: [DevicesRepository, DevicesService, OwnershipRepository, OwnershipService, InternalDeviceGuard],
  exports: [DevicesService, OwnershipService] })
export class DevicesModule {}
