import {Module}from'@nestjs/common';import{DatabaseModule}from'../../database/database.module';import{SystemSettingsRepository}from'./system-settings.repository';import{SystemSettingsService}from'./system-settings.service';import{SystemSettingsController}from'./system-settings.controller';

@Module({imports:[DatabaseModule],providers:[SystemSettingsRepository,SystemSettingsService],controllers:[SystemSettingsController]})
export class SystemSettingsModule {}
