import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { ApiKeysController,SystemApiKeysController } from '../api-keys/api-keys.controller';
import { AiProfilesController,InternalAIConfigController } from '../ai-profiles/ai-profiles.controller';
import { AIActorGuard,InternalAIConfigGuard } from './ai.guards';
import { AiProvidersController,AdminProvidersController } from './ai-providers.controller';
import { AiProvidersRepository } from './ai-providers.repository';
import { AiProvidersService } from './ai-providers.service';

@Module({imports:[ConfigModule,DatabaseModule,UsersModule],
  controllers:[AiProvidersController,AdminProvidersController,AiProfilesController,InternalAIConfigController,ApiKeysController,SystemApiKeysController],
  providers:[AiProvidersRepository,AiProvidersService,SecretEncryptionService,AIActorGuard,InternalAIConfigGuard,AdminDeviceGuard,UserPairingGuard],
  exports:[AiProvidersService]})
export class AiProvidersModule{}
