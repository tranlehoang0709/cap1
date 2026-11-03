import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { UsersModule } from '../users/users.module';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { QuotaSourceGuard } from './quota-source.guard';
import { QuotasRepository } from './quotas.repository';
import { QuotasService } from './quotas.service';
import { InternalQuotasController, AdminQuotasController, UserUsageController } from './quotas.controller';
import { UsageReportSweeper } from './usage-report-sweeper';

@Module({imports:[DatabaseModule,AiProvidersModule,UsersModule],controllers:[InternalQuotasController,AdminQuotasController,UserUsageController],
  providers:[QuotasRepository,QuotasService,QuotaSourceGuard,AdminDeviceGuard,UserPairingGuard,UsageReportSweeper],exports:[QuotasService]})
export class QuotasModule {}
