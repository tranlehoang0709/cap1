import { BadRequestException } from '@nestjs/common';
import { DeviceQueryDto } from '../../devices/dto/device-query.dto';

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];

export function pairingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value) > 9223372036854775807n) throw new BadRequestException('Invalid request ID');
  return value;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required');
  }
  return value as Record<string, unknown>;
}

export function pairingCode(value: unknown): string {
  // Exact bytes: do not silently normalize a provisioned secret.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(value)) {
    throw new BadRequestException('pairingCode must contain 6–128 letters, digits, underscores or hyphens');
  }
  return value;
}

export class CreatePairingDto {
  static parse(body: unknown): string {
    const value = objectBody(body);
    if (Object.keys(value).some(key => key !== 'pairingCode')) throw new BadRequestException('Unknown body field');
    return pairingCode(value.pairingCode);
  }
}

export class ReviewPairingDto {
  static parse(body: unknown): string | null {
    const value = body === undefined ? {} : objectBody(body);
    if (Object.keys(value).some(key => key !== 'reviewNote')) throw new BadRequestException('Unknown body field');
    if (value.reviewNote === undefined) return null;
    if (typeof value.reviewNote !== 'string' || value.reviewNote.length > 500
      || /[\u0000-\u001f\u007f]/.test(value.reviewNote)) {
      throw new BadRequestException('reviewNote must be text of at most 500 characters without control characters');
    }
    return value.reviewNote.trim() || null;
  }
}

export class PairingListDto {
  page = 1;
  limit = 20;
  status?: RequestStatus;

  static parse(value: Record<string, unknown>): PairingListDto {
    if (Object.keys(value).some(key => !['page', 'limit', 'status'].includes(key))) {
      throw new BadRequestException('Unknown list filter');
    }
    const bounds = DeviceQueryDto.parse({page: value.page, limit: value.limit});
    const query = new PairingListDto();
    query.page = bounds.page;
    query.limit = bounds.limit;
    if (value.status !== undefined) {
      if (typeof value.status !== 'string'
        || !REQUEST_STATUSES.includes(value.status.toLowerCase() as RequestStatus)) {
        throw new BadRequestException('Invalid pairing request status');
      }
      query.status = value.status.toLowerCase() as RequestStatus;
    }
    return query;
  }
}
