import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CalendarController, InternalReminderController, ReminderController } from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService, ReminderService } from './calendar.service';
import { ToolExecutionController } from './tool-execution.controller';
import { CalendarConfirmationService } from './confirmation.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';

@Module({ imports: [DatabaseModule, AuthModule, UsersModule, DevicesModule], controllers: [CalendarController, ReminderController, InternalReminderController, ToolExecutionController], providers: [CalendarRepository, CalendarService, ReminderService, CalendarConfirmationService] })
export class CalendarModule {}
