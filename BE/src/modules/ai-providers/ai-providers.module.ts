import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiProvidersRepository } from './ai-providers.repository';
import { AiProvidersService } from './ai-providers.service';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { InternalAIConfigGuard } from './ai.guards';
import { AiProfilesController, InternalAIConfigController } from '../ai-profiles/ai-profiles.controller';
import { UsersModule } from '../users/users.module';
import { UserPairingGuard } from '../pairing/user-pairing.guard';

@Module({imports:[DatabaseModule,UsersModule],controllers:[InternalAIConfigController,AiProfilesController],
  providers:[AiProvidersRepository,AiProvidersService,SecretEncryptionService,InternalAIConfigGuard,UserPairingGuard],
  exports:[AiProvidersService]})
export class AiProvidersModule {}
