import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CalendarController, InternalReminderController, ReminderController } from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService, ReminderService } from './calendar.service';

@Module({ imports: [DatabaseModule], controllers: [CalendarController, ReminderController, InternalReminderController], providers: [CalendarRepository, CalendarService, ReminderService] })
export class CalendarModule {}
