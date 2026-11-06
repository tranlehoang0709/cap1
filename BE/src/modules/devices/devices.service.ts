import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DevicesRepository } from './devices.repository';
import { DevicesServiceError } from './devices.errors';
import { PairingService } from '../pairing/pairing.service';
import { DevicePrincipal, DeviceRecord, PairingRequestRecord } from './devices.types';

@Injectable()
export class DevicesService {
  constructor(private readonly repository: DevicesRepository, private readonly pairing: PairingService) {}

  async register(uid: string, name?: string, model?: string, actorId: string | null = null) {
    try {
      return await this.repository.transaction(async repo => {
        const device = await repo.createDevice(uid.trim(), name?.trim() || null, model?.trim() || null);
        await repo.audit(actorId, 'DEVICE_REGISTERED', device.id, {device_uid:device.device_uid});
        const code = await this.issuePairingCode(repo, actorId, device.id, 10);
        return {...device, ...code};
      });
    } catch (error) { if (this.duplicate(error)) throw new DevicesServiceError('INVALID_INPUT', 'Device UID is already registered'); throw error; }
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
      return this.issuePairingCode(repo, actorId, deviceId, ttlMinutes);
    });
  }

  private async issuePairingCode(repo: DevicesRepository, actorId: string | null, deviceId: string, ttlMinutes: number) {
    // One gate for every code issuer, including registration's initial code.
    await repo.assertPairingReady(deviceId);
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await repo.createPairingCode(deviceId, this.hash(code), expiresAt);
    await repo.audit(actorId, 'DEVICE_PAIRING_CODE_ISSUED', deviceId, {expires_at:expiresAt.toISOString()});
    return {pairing_code:code, expires_at:expiresAt};
  }

  async requestPairing(userId: string, code: string): Promise<PairingRequestRecord> {
    const result = await this.pairing.createPairingRequest({userId,role:'USER'}, {pairingCode:code});
    return this.requestRecord(result.id);
  }

  private async requestRecord(id: string): Promise<PairingRequestRecord> {
    const request = await this.repository.findRequestById(id);
    if (!request) throw new Error('Pairing request disappeared');
    return request;
  }

  async listRequests(userId: string | null, page: number, limit: number) { return this.wrap(() => this.repository.listRequests(userId, page, limit)); }

  async reviewPairing(adminId: string, requestId: string, approved: boolean, note?: string): Promise<PairingRequestRecord> {
    const actor = {userId:adminId,role:'ADMIN' as const};
    const body = note === undefined ? {} : {reviewNote:note};
    if (approved) await this.pairing.approvePairing(requestId, actor, body);
    else await this.pairing.rejectPairing(requestId, actor, body);
    return this.requestRecord(requestId);
  }

  async unlink(_userId: string, _deviceId: string): Promise<never> {
    throw new ForbiddenException({
      error: 'ADMIN_RECOVERY_REQUIRED',
      message: 'Direct unlink is disabled. An Admin must use POST /admin/devices/{id}/revoke and wait for confirmed reset.',
    });
  }

  async issueCredential(actorId: string, deviceId: string): Promise<{ credential: string }> {
    return this.repository.transaction(async (repo) => {
      const device = await repo.findById(deviceId, true);
      if (!device) throw new DevicesServiceError('DEVICE_NOT_FOUND', 'Device was not found');
      await repo.assertCredentialReady(deviceId);
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
