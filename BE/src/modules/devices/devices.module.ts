import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AdminDeviceGuard } from './admin-device.guard';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { OwnershipRepository } from './ownership.repository';
import { OwnershipService } from './ownership.service';
import { InternalDeviceGuard } from './internal-device.guard';
import { DashboardAccessController, InternalDevicesController, UserDevicesController } from './ownership.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, UsersModule],
  controllers: [DevicesController, UserDevicesController, DashboardAccessController, InternalDevicesController],
  providers: [DevicesRepository, DevicesService, AdminDeviceGuard, UserPairingGuard,
    OwnershipRepository, OwnershipService, InternalDeviceGuard],
  exports:[OwnershipService],
})
export class DevicesModule {}
