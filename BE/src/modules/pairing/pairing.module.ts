import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { AdminPairingController, UserPairingController } from './pairing.controller';
import { PairingRepository } from './pairing.repository';
import { PairingService } from './pairing.service';
import { UserPairingGuard } from './user-pairing.guard';

@Module({
  imports:[ConfigModule,DatabaseModule,UsersModule],
  controllers:[UserPairingController,AdminPairingController],
  providers:[PairingRepository,PairingService,AdminDeviceGuard,UserPairingGuard],
})
export class PairingModule {}
