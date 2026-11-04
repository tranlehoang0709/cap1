import { Module } from '@nestjs/common'; import {DatabaseModule} from '../../database/database.module'; import {MonitoringRepository} from './monitoring.repository'; import {MonitoringService} from './monitoring.service'; import {MonitoringController} from './monitoring.controller';

@Module({imports:[DatabaseModule],providers:[MonitoringRepository,MonitoringService],controllers:[MonitoringController]})
export class MonitoringModule {}
