import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiProvidersRepository } from './ai-providers.repository';
import { AiProvidersService } from './ai-providers.service';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';
import { InternalAIConfigGuard } from './ai.guards';
import { InternalAIConfigController } from '../ai-profiles/ai-profiles.controller';

@Module({imports:[DatabaseModule],controllers:[InternalAIConfigController],
  providers:[AiProvidersRepository,AiProvidersService,SecretEncryptionService,InternalAIConfigGuard],
  exports:[AiProvidersService]})
export class AiProvidersModule {}
