import { AIWebChatClient } from '../web-chat/ai-web-chat.client';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';
import { AiController } from './ai.controller';
import { AiRepository } from './ai.repository';
import { AiService } from './ai.service';
@Module({imports:[DatabaseModule],controllers:[AiController],providers:[AiRepository,AiService,SecretCipherService,AIWebChatClient],exports:[AiService]}) export class AiModule {}
