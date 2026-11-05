import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { MonitoringRepository } from './monitoring.repository';
import { MonitoringService } from './monitoring.service';
import { MonitoringController, HeartbeatController, AdminMonitoringController, UserMonitoringController } from './monitoring.controller';

@Module({imports:[DatabaseModule,UsersModule,DevicesModule],
  providers:[MonitoringRepository,MonitoringService,AdminDeviceGuard,InternalDeviceGuard,UserPairingGuard],
  controllers:[MonitoringController,HeartbeatController,AdminMonitoringController,UserMonitoringController]})
export class MonitoringModule {}
