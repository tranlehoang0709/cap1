import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringRepository } from './monitoring.repository';
import { OwnershipService } from '../devices/ownership.service';
import { CurrentUser } from '../auth/access-role.guard';
import { deviceId } from '../devices/dto/device-query.dto';
import { heartbeatInput } from './dto/heartbeat.dto';

export function calculateDeviceStatus(lastSeenAt: Date|null, now: Date, timeoutSeconds: number): 'online'|'offline' {
  const age = lastSeenAt ? now.getTime()-lastSeenAt.getTime() : NaN;
  return Number.isFinite(age) && age >= 0 && age < timeoutSeconds*1000 ? 'online' : 'offline';
}

@Injectable()
export class MonitoringService {
  constructor(private readonly repo: MonitoringRepository, private readonly ownership: OwnershipService, private readonly config: ConfigService) {}
  dashboard() { return this.repo.dashboard(); }
  instances() { return this.repo.instances(); }
  heartbeat(data: Record<string, unknown>) { return this.repo.heartbeat(data); }
  metrics(id: string, data: Record<string, unknown>) { return this.repo.metrics(id, data); }
  timeoutSeconds(): number {
    const value = this.config.get<string>('HEARTBEAT_TIMEOUT_SECONDS') ?? '60';
    if (!/^[1-9][0-9]*$/.test(value) || Number(value)>2147483) throw new ConflictException('HEARTBEAT_TIMEOUT_NOT_CONFIGURED');
    return Number(value);
  }
  private async database<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((error as {code?:string})?.code ?? '')) throw new ConflictException('AUTHORIZATION_RETRY');
      throw new InternalServerErrorException('MONITORING_UNAVAILABLE');
    }
  }
  async processHeartbeat(body: unknown) {
    if (this.config.get<string>('DEVICE_AUTH_CONTRACT_APPROVED') !== 'true') throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    const event = heartbeatInput(body), timeout = this.timeoutSeconds();
    return this.database(() => this.repo.transaction(async tx => {
      const proof = await this.ownership.validateAuthorizedDevice(tx.ownership,event.deviceUid,event.credential,404);
      const presence = await tx.presence(proof.deviceId);
      if (event.observedAt > presence.now) throw new ConflictException('HEARTBEAT_FROM_FUTURE');
      if (event.observedAt.getTime() <= presence.now.getTime()-timeout*1000 || presence.lastSeenAt && event.observedAt <= presence.lastSeenAt)
        return {accepted:false,reason:'STALE_OR_DUPLICATE',deviceId:proof.deviceId,lastSeenAt:presence.lastSeenAt};
      await tx.updateDevicePresence(proof.deviceId,event.observedAt);
      await tx.saveDeviceTelemetry(proof.deviceId,event);
      return {accepted:true,deviceId:proof.deviceId,lastSeenAt:event.observedAt};
    }));
  }
  async getDeviceMonitoring(actor: CurrentUser, input: unknown) {
    if (!actor || !['ADMIN','USER'].includes(actor.role)) throw new ForbiddenException('Required role missing');
    const id = deviceId(input), userId = deviceId(actor.userId), timeout = this.timeoutSeconds();
    return this.database(() => this.repo.transaction(async tx => {
      if (actor.role === 'USER') await this.ownership.verifyOwnershipInTransaction(tx.ownership,userId,id);
      else {
        const u = await tx.ownership.devices.users.findByIdForUpdate(userId);
        const roles = u ? await tx.ownership.devices.users.findUserRoles(userId) : [];
        if (!u || u.status!=='active' || !u.email_verified_at || roles.length!==1 || roles[0].code!=='ADMIN') throw new ForbiddenException('Active verified Admin required');
        if (!await tx.ownership.devices.findDeviceById(id)) throw new NotFoundException('Device not found');
      }
      const presence = await tx.presence(id), connectionStatus = calculateDeviceStatus(presence.lastSeenAt,presence.now,timeout);
      if (connectionStatus === 'offline') await tx.markDeviceOffline(id,presence.now,timeout);
      return {deviceId:id,connectionStatus,lastSeenAt:presence.lastSeenAt,telemetry:await tx.telemetry(id)};
    }));
  }
  markExpiredDevicesOffline() { return this.database(() => this.repo.markExpiredDevicesOffline(this.timeoutSeconds())); }
}
