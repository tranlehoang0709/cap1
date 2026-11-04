import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InternalApiController } from './internal-api.controller';
import { InternalApiRepository } from './internal-api.repository';
import { InternalApiService } from './internal-api.service';
import { AiServerServiceGuard } from '../../common/guards/ai-server-service.guard';
@Module({ imports:[DatabaseModule], controllers:[InternalApiController], providers:[InternalApiRepository,InternalApiService,AiServerServiceGuard] })
export class InternalApiModule {}
