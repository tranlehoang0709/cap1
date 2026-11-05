import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration, { validateEnvironment } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './api/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DeviceAuthGuard } from './common/guards/device-auth.guard';
import { AiProfilesModule } from './modules/ai-profiles/ai-profiles.module';
import { AiModule } from './modules/ai/ai.module';
import { AiProvidersModule } from './modules/ai-providers/ai-providers.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DevicesModule } from './modules/devices/devices.module';
import { FirmwareOtaModule } from './modules/firmware-ota/firmware-ota.module';
import { LogsModule } from './modules/logs/logs.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { UsersModule } from './modules/users/users.module';
import { WebChatModule } from './modules/web-chat/web-chat.module';
import { InternalApiModule } from './modules/internal-api/internal-api.module';
import { PairingModule } from './modules/pairing/pairing.module';
import { RecoveryModule } from './modules/device-recovery/recovery.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    // Static pairing routes must precede UserDevicesController /:id.
    PairingModule,
    DevicesModule,
    ConversationsModule,
    WebChatModule,
    AiProvidersModule,
    AiProfilesModule,
    AiModule,
    ApiKeysModule,
    QuotasModule,
    FirmwareOtaModule,
    LogsModule,
    MonitoringModule,
    SystemSettingsModule,
    InternalApiModule,
    RecoveryModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: DeviceAuthGuard },
  ],
})
export class AppModule {}
