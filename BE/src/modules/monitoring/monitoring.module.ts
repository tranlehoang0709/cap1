import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { InternalDeviceGuard } from '../devices/internal-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AdminMonitoringController,HeartbeatController,UserMonitoringController } from './monitoring.controller';
import { MonitoringRepository } from './monitoring.repository';
import { MonitoringService } from './monitoring.service';
import { PresenceSweeper } from './presence-sweeper';

@Module({imports:[ConfigModule,DatabaseModule,UsersModule,DevicesModule],
  controllers:[HeartbeatController,AdminMonitoringController,UserMonitoringController],
  providers:[MonitoringRepository,MonitoringService,PresenceSweeper,AdminDeviceGuard,InternalDeviceGuard,UserPairingGuard]})
export class MonitoringModule{}
