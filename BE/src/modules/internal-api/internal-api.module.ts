import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InternalApiController } from './internal-api.controller';
import { InternalApiRepository } from './internal-api.repository';
import { InternalApiService } from './internal-api.service';
@Module({ imports:[DatabaseModule], controllers:[InternalApiController], providers:[InternalApiRepository,InternalApiService] })
export class InternalApiModule {}
