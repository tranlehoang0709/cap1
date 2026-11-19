import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PersonalAssistantController } from './personal-assistant.controller';
import { PersonalAssistantRepository } from './personal-assistant.repository';
import { PersonalAssistantService } from './personal-assistant.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PersonalAssistantController],
  providers: [PersonalAssistantRepository, PersonalAssistantService],
  exports: [PersonalAssistantService],
})
export class PersonalAssistantModule {}
