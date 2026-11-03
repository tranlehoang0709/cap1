import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringRepository, MonitoringTransaction } from './monitoring.repository';
import { OwnershipService } from '../devices/ownership.service';
import { heartbeatInput } from './dto/heartbeat.dto';
import { CurrentUser } from '../auth/access-role.guard';
import { deviceId } from '../devices/dto/device-query.dto';

export function calculateDeviceStatus(lastSeenAt: Date|null, now: Date, seconds: number) {
  return lastSeenAt && lastSeenAt<=now && lastSeenAt.getTime()>now.getTime()-seconds*1000 ? 'online' : 'offline';
}
@Injectable()
export class MonitoringService {
  constructor(private readonly r: MonitoringRepository,private readonly ownership: OwnershipService,private readonly config: ConfigService) {}
  dashboard(){return this.r.dashboard();} instances(){return this.r.instances();}
  timeoutSeconds(){const value=this.config.get<string>('HEARTBEAT_TIMEOUT_SECONDS')??'60';
    if(!/^[1-9][0-9]*$/.test(value)||Number(value)>2147483) throw new ConflictException('HEARTBEAT_TIMEOUT_NOT_CONFIGURED');return Number(value);}
  private async database<T>(work:(tx:MonitoringTransaction)=>Promise<T>):Promise<T>{
    try{return await this.r.transaction(work);}catch(e){if(e instanceof HttpException)throw e;
      if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((e as {code?:string})?.code??''))throw new ConflictException('MONITORING_RETRY');
      throw new InternalServerErrorException('MONITORING_UNAVAILABLE');}}
  async processHeartbeat(body:unknown){
    if(this.config.get<string>('DEVICE_AUTH_CONTRACT_APPROVED')!=='true') throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    const event=heartbeatInput(body),timeout=this.timeoutSeconds();
    return this.database(async tx=>{
      const auth=await this.ownership.validateAuthorizedDevice(tx.ownership,event.deviceUid,event.credential,404);
      const {lastSeenAt,now}=await tx.presence(auth.deviceId);
      if(event.observedAt>now) throw new ConflictException('HEARTBEAT_FROM_FUTURE');
      if(event.observedAt.getTime()<=now.getTime()-timeout*1000 || lastSeenAt && event.observedAt<=lastSeenAt) return {accepted:false,deviceId:auth.deviceId,lastSeenAt,reason:'STALE_OR_DUPLICATE'};
      await tx.updateDevicePresence(auth.deviceId,event.observedAt);await tx.saveDeviceTelemetry(auth.deviceId,event);
      return {accepted:true,deviceId:auth.deviceId,lastSeenAt:event.observedAt};
    });
  }
  async getDeviceMonitoring(actor:CurrentUser,id:string){
    id=deviceId(id);return this.database(async tx=>{
      if(actor.role==='USER') await this.ownership.verifyOwnershipInTransaction(tx.ownership,deviceId(actor.userId),id);
      else if(actor.role==='ADMIN'){
        if(!await tx.ownership.devices.findDeviceById(id))throw new NotFoundException('Device not found');
        const u=await tx.ownership.devices.users.findByIdForUpdate(actor.userId),roles=u?await tx.ownership.devices.users.findUserRoles(actor.userId):[];
        if(!u||u.status!=='active'||u.email_verified_at===null||roles.length!==1||roles[0].code!=='ADMIN')throw new ForbiddenException();
      }else throw new ForbiddenException();
      const {lastSeenAt,now}=await tx.presence(id),connectionStatus=calculateDeviceStatus(lastSeenAt,now,this.timeoutSeconds());
      if(connectionStatus==='offline')await tx.markDeviceOffline(id,now,this.timeoutSeconds());
      return {deviceId:id,lastSeenAt,connectionStatus,telemetry:await tx.telemetry(id)};
    });
  }
  async markExpiredDevicesOffline(){await this.r.markExpiredDevicesOffline(this.timeoutSeconds());}
}
