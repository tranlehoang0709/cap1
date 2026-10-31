import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { QuotaSourceGuard } from './quota-source.guard';
import { AdminQuotasController,InternalQuotasController,UserUsageController } from './quotas.controller';
import { QuotasRepository } from './quotas.repository';
import { QuotasService } from './quotas.service';
import { UsageReportSweeper } from './usage-report-sweeper';
@Module({imports:[ConfigModule,DatabaseModule,UsersModule,AiProvidersModule],controllers:[AdminQuotasController,InternalQuotasController,UserUsageController],
  providers:[QuotasRepository,QuotasService,QuotaSourceGuard,AdminDeviceGuard,UserPairingGuard,UsageReportSweeper]})
export class QuotasModule{}
