import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DevicesRepository } from './devices.repository';
import { DeviceQueryDto, deviceId } from './dto/device-query.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly repository: DevicesRepository) {}

  async list(input: Record<string, unknown>) {
    const query = DeviceQueryDto.parse(input);
    try { return await this.repository.list(query); }
    catch { throw new InternalServerErrorException('Unable to read devices'); }
  }

  async detail(input: unknown) {
    const id = deviceId(input);
    let device;
    try { device = await this.repository.findById(id); }
    catch { throw new InternalServerErrorException('Unable to read device'); }
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }
}
