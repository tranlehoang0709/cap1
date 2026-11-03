import { Module } from '@nestjs/common'; import {DatabaseModule} from '../../database/database.module'; import {MonitoringRepository} from './monitoring.repository'; import {MonitoringService} from './monitoring.service'; import {MonitoringController} from './monitoring.controller';
import { DevicesModule } from '../devices/devices.module';
import { UsersModule } from '../users/users.module';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { HeartbeatController,AdminMonitoringController,UserMonitoringController } from './monitoring.controller';

@Module({imports:[DatabaseModule,DevicesModule,UsersModule],providers:[MonitoringRepository,MonitoringService,InternalDeviceGuard,AdminDeviceGuard,UserPairingGuard],
  controllers:[MonitoringController,HeartbeatController,AdminMonitoringController,UserMonitoringController]})
export class MonitoringModule {}
