import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration, { validateEnvironment } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { DevicesModule } from './modules/devices/devices.module';
import { PairingModule } from './modules/pairing/pairing.module';
import { AiProvidersModule } from './modules/ai-providers/ai-providers.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { RecoveryModule } from './modules/device-recovery/recovery.module';
import { QuotasModule } from './modules/quotas/quotas.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV==='test'?'.env.test':'.env',
      load: [configuration],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    UsersModule,
    PairingModule,
    // Static /user/devices/pairing-requests must register before /user/devices/:id.
    DevicesModule,
    AiProvidersModule,
    MonitoringModule,
    RecoveryModule,
    QuotasModule,
  ],
})
export class AppModule {}
