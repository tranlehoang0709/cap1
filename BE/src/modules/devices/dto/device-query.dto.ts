import { BadRequestException } from '@nestjs/common';

export function deviceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException('deviceId must be a positive BIGINT');
  }
  return value;
}

export class DeviceQueryDto {
  page = 1;
  limit = 20;
  search = '';
  connectionStatus?: string;

  static parse(input: Record<string, unknown>): DeviceQueryDto {
    const dto = new DeviceQueryDto();
    for (const key of ['page', 'limit'] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new BadRequestException(`${key} must be a positive integer`);
      }
      dto[key] = Number(value);
      if (!Number.isSafeInteger(dto[key]) || dto[key] > (key === 'limit' ? 100 : 1000000)) {
        throw new BadRequestException(`${key} exceeds the supported range`);
      }
    }
    if (input.search !== undefined) {
      if (typeof input.search !== 'string' || input.search.length > 128
        || /[\u0000-\u001f\u007f]/.test(input.search)) {
        throw new BadRequestException('search must be text of at most 128 characters without control characters');
      }
      dto.search = input.search.trim();
    }
    if (input.connectionStatus !== undefined) {
      if (typeof input.connectionStatus !== 'string'
        || !/^[a-z][a-z0-9_]{0,19}$/.test(input.connectionStatus)) {
        throw new BadRequestException('connectionStatus must be a lowercase status of at most 20 characters');
      }
      dto.connectionStatus = input.connectionStatus;
    }
    return dto;
  }
}
