import { Module } from '@nestjs/common'; import { DatabaseModule } from '../../database/database.module';
import { LogsRepository } from './logs.repository';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';

@Module({ imports:[DatabaseModule], providers:[LogsRepository,LogsService], controllers:[LogsController] })
export class LogsModule {}
