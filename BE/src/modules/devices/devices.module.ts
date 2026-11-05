import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { UserDevicesController, DashboardAccessController, InternalDevicesController } from './ownership.controller';
import { OwnershipRepository } from './ownership.repository';
import { OwnershipService } from './ownership.service';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { InternalDeviceGuard } from './internal-device.guard';

@Module({ imports: [DatabaseModule, ConfigModule, UsersModule], controllers: [DevicesController, UserDevicesController, DashboardAccessController, InternalDevicesController], providers: [DevicesRepository, DevicesService, OwnershipRepository, OwnershipService, UserPairingGuard, InternalDeviceGuard], exports: [DevicesService, OwnershipService] })
export class DevicesModule {}
