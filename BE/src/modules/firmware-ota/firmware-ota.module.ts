import{Module}from'@nestjs/common';import{DatabaseModule}from'../../database/database.module';import{FirmwareOtaRepository}from'./firmware-ota.repository';import{FirmwareOtaService}from'./firmware-ota.service';import{FirmwareOtaController}from'./firmware-ota.controller';

@Module({imports:[DatabaseModule],providers:[FirmwareOtaRepository,FirmwareOtaService],controllers:[FirmwareOtaController]})
export class FirmwareOtaModule {}
