import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CalendarController, InternalReminderController, ReminderController } from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService, ReminderService } from './calendar.service';
import { ToolExecutionController } from './tool-execution.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({ imports: [DatabaseModule, AuthModule, UsersModule], controllers: [CalendarController, ReminderController, InternalReminderController, ToolExecutionController], providers: [CalendarRepository, CalendarService, ReminderService] })
export class CalendarModule {}
