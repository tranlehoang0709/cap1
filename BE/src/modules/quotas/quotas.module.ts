import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { V15QuotasRepository } from './v15-quota-ledger';
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
  providers:[{provide:QuotasRepository,inject:[MYSQL_POOL,ConfigService],useFactory:(pool:Pool,config:ConfigService)=>
    config.get<string>('AI_QUOTA_STORAGE')==='v15-settings'
      ? new V15QuotasRepository(pool,config.get<string>('AI_QUOTA_V15_CONTRACT_APPROVED')==='true')
      : new QuotasRepository(pool)},QuotasService,QuotaSourceGuard,AdminDeviceGuard,UserPairingGuard,UsageReportSweeper],exports:[QuotasService]})
export class QuotasModule {}
