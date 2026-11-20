import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';
import { AiController } from './ai.controller';
import { AiRepository } from './ai.repository';
import { AiService } from './ai.service';
import { AuthModule } from '../auth/auth.module';
import { Pa08ChatRepository } from './pa08-chat.repository';
@Module({imports:[DatabaseModule,AuthModule],controllers:[AiController],providers:[AiRepository,Pa08ChatRepository,AiService,SecretCipherService],exports:[AiService]}) export class AiModule {}
