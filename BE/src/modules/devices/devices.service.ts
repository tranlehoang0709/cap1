import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DevicesRepository } from './devices.repository';
import { DevicesServiceError } from './devices.errors';
import { DevicePrincipal, DeviceRecord, PairingRequestRecord } from './devices.types';

@Injectable()
export class DevicesService {
  constructor(private readonly repository: DevicesRepository) {}

  async register(uid: string, name?: string, model?: string): Promise<DeviceRecord> {
    try {
      const device = await this.repository.createDevice(uid.trim(), name?.trim() || null, model?.trim() || null);
      await this.repository.audit(null, 'DEVICE_REGISTERED', device.id, { device_uid: device.device_uid });
      return device;
    } catch (error) { if (this.duplicate(error)) throw new DevicesServiceError('INVALID_INPUT', 'Device UID is already registered'); throw this.databaseError(error); }
  }

  async list(userId: string | null, page: number, limit: number) { return this.wrap(() => this.repository.listDevices(userId, page, limit)); }
  async getOwned(userId:string,deviceId:string){const device=await this.repository.findOwnedByUser(deviceId,userId);if(!device)throw new DevicesServiceError('DEVICE_NOT_OWNED','Device is not owned by this user');return device;}

  async rename(userId: string, deviceId: string, name: string): Promise<DeviceRecord> {
    return this.repository.transaction(async (repo) => {
      const device = await repo.findOwnedByUser(deviceId, userId, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_OWNED', 'Device is not owned by this user');
      const updated = await repo.updateName(deviceId, name.trim());
      await repo.audit(userId, 'DEVICE_RENAMED', deviceId, { display_name: updated.display_name });
      return updated;
    });
  }

  async createPairingCode(actorId: string, deviceId: string, ttlMinutes: number): Promise<{ pairing_code: string; expires_at: Date }> {
    return this.repository.transaction(async (repo) => {
      const device = await repo.findById(deviceId, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_FOUND', 'Device was not found');
      if (device.lifecycle_status !== 'available') throw new DevicesServiceError('DEVICE_NOT_AVAILABLE', 'Only available devices can receive a pairing code');
      const code = randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
      await repo.createPairingCode(deviceId, this.hash(code), expiresAt);
      await repo.audit(actorId, 'DEVICE_PAIRING_CODE_ISSUED', deviceId, { expires_at: expiresAt.toISOString() });
      return { pairing_code: code, expires_at: expiresAt };
    });
  }

  async requestPairing(userId: string, code: string): Promise<PairingRequestRecord> {
    return this.repository.transaction(async (repo) => {
      const pairingCode = await repo.consumePairingCode(this.hash(code));
      if (!pairingCode) throw new DevicesServiceError('PAIRING_CODE_INVALID', 'Pairing code is invalid, expired, or already used');
      const device = await repo.findById(pairingCode.device_id, true);
      if (!device || device.lifecycle_status !== 'available') throw new DevicesServiceError('DEVICE_NOT_AVAILABLE', 'Device is unavailable for pairing');
      const request = await repo.createPairingRequest(device.id, userId, pairingCode.id);
      await repo.audit(userId, 'DEVICE_PAIRING_REQUESTED', device.id, { pairing_request_id: request.id });
      return request;
    });
  }

  async listRequests(userId: string | null, page: number, limit: number) { return this.wrap(() => this.repository.listRequests(userId, page, limit)); }

  async reviewPairing(adminId: string, requestId: string, approved: boolean, note?: string): Promise<PairingRequestRecord> {
    return this.repository.transaction(async (repo) => {
      const request = await repo.findRequestById(requestId, true);
      if (!request) throw new DevicesServiceError('PAIRING_REQUEST_NOT_FOUND', 'Pairing request was not found');
      if (request.status !== 'pending') throw new DevicesServiceError('PAIRING_REQUEST_INVALID_STATE', 'Pairing request has already been reviewed');
      const device = await repo.findById(request.device_id, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_FOUND', 'Device was not found');
      if (approved) {
        if (device.lifecycle_status !== 'available') throw new DevicesServiceError('DEVICE_ALREADY_ASSIGNED', 'Device is no longer available');
        await repo.approveRequest(request, adminId, note?.trim() || null);
      } else await repo.rejectRequest(request.id, adminId, note?.trim() || null);
      await repo.audit(adminId, approved ? 'DEVICE_PAIRING_APPROVED' : 'DEVICE_PAIRING_REJECTED', device.id, { pairing_request_id: request.id });
      const reviewed = await repo.findRequestById(requestId);
      if (!reviewed) throw new Error('Pairing request disappeared'); return reviewed;
    });
  }

  async unlink(userId: string, deviceId: string): Promise<{ success: true }> {
    await this.repository.transaction(async (repo) => {
      const device = await repo.findOwnedByUser(deviceId, userId, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_OWNED', 'Device is not owned by this user');
      await repo.unlink(device, userId);
      await repo.audit(userId, 'DEVICE_UNLINKED', deviceId, {});
    });
    return { success: true };
  }

  async issueCredential(actorId: string, deviceId: string): Promise<{ credential: string }> {
    return this.repository.transaction(async (repo) => {
      const device = await repo.findById(deviceId, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_FOUND', 'Device was not found');
      const credential = randomBytes(32).toString('base64url');
      await repo.issueCredential(deviceId, this.hash(credential));
      await repo.audit(actorId, 'DEVICE_CREDENTIAL_ISSUED', deviceId, {});
      return { credential };
    });
  }

  async verifyCredential(credential: string): Promise<DevicePrincipal> {
    const found = await this.wrap(() => this.repository.findCredential(this.hash(credential)));
    if (!found) throw new DevicesServiceError('CREDENTIAL_INVALID', 'Device credential is invalid or revoked');
    return { deviceId: found.device_id, deviceUid: found.device_uid };
  }

  async heartbeat(principal: DevicePrincipal, battery: number | undefined, rssi: number | undefined, heap: string | undefined): Promise<DeviceRecord> {
    return this.repository.transaction(async (repo) => {
      const device = await repo.recordHeartbeat(principal.deviceId, battery ?? null, rssi ?? null, heap ?? null);
      await repo.audit(null, 'DEVICE_HEARTBEAT', principal.deviceId, { battery_percent: battery ?? null, wifi_rssi: rssi ?? null });
      return device;
    });
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private async wrap<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { if (error instanceof DevicesServiceError) throw error; throw this.databaseError(error); } }
  private databaseError(error: unknown) { return new DevicesServiceError('DATABASE_ERROR', 'A database operation failed'); }
  private duplicate(error: unknown) { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }
}
