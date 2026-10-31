import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { InternalResetController,RecoveryController } from './recovery.controller';
import { RecoveryRepository } from './recovery.repository';
import { RecoveryService } from './recovery.service';
import { RecoveryStore } from './recovery-store';
import { ResetSourceGuard } from './reset-source.guard';

@Module({imports:[ConfigModule,DatabaseModule,UsersModule],controllers:[RecoveryController,InternalResetController],
  providers:[RecoveryRepository,RecoveryService,RecoveryStore,SecretEncryptionService,AdminDeviceGuard,ResetSourceGuard],exports:[RecoveryService]})
export class RecoveryModule{}
