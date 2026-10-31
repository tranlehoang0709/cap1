import { ConflictException,ForbiddenException,HttpException,Injectable,InternalServerErrorException,NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/access-role.guard';
import { deviceId } from '../devices/dto/device-query.dto';
import { OwnershipService } from '../devices/ownership.service';
import { MonitoringRepository } from './monitoring.repository';
import { heartbeatInput } from './dto/heartbeat.dto';

export function calculateDeviceStatus(lastSeenAt:Date|null,now:Date,timeoutSeconds:number):'online'|'offline'{
  const age=lastSeenAt?now.getTime()-lastSeenAt.getTime():Infinity;
  return age>=0&&age<timeoutSeconds*1000?'online':'offline';
}
@Injectable()
export class MonitoringService {
  constructor(private readonly repository:MonitoringRepository,private readonly ownership:OwnershipService,private readonly config:ConfigService){}
  timeoutSeconds():number{
    // 60 seconds explicitly approved by the user in Prompt 5, not inferred from MQTT.
    const value=this.config.get<string|number>('HEARTBEAT_TIMEOUT_SECONDS')??60;
    if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>2147483)throw new ConflictException('INVALID_HEARTBEAT_TIMEOUT');
    return Number(value);
  }
  async processHeartbeat(body:unknown){
    if(this.config.get<string>('DEVICE_AUTH_CONTRACT_APPROVED')!=='true')throw new ForbiddenException({accepted:false,reason:'CONTRACT_NOT_APPROVED'});
    const event=heartbeatInput(body);const timeout=this.timeoutSeconds();
    return this.errors(()=>this.repository.transaction(async tx=>{
      // Credential/ownership validation and presence writes share the same parent lock.
      const authorization=await this.ownership.validateAuthorizedDevice(tx.ownership,event.deviceUid,event.credential,404);
      const presence=await tx.presence(authorization.deviceId);
      if(!presence)throw new NotFoundException('Device not found');
      if(event.observedAt.getTime()>presence.now.getTime())throw new ConflictException('HEARTBEAT_FROM_FUTURE');
      if((presence.lastSeenAt&&event.observedAt<=presence.lastSeenAt)||presence.now.getTime()-event.observedAt.getTime()>=timeout*1000){
        return {accepted:false,deviceId:authorization.deviceId,lastSeenAt:presence.lastSeenAt,reason:'STALE_OR_DUPLICATE'};
      }
      await tx.updateDevicePresence(authorization.deviceId,event.observedAt);
      await tx.saveDeviceTelemetry(authorization.deviceId,event);
      return {accepted:true,deviceId:authorization.deviceId,lastSeenAt:event.observedAt};
    }));
  }
  async getDeviceMonitoring(actor:CurrentUser,input:unknown){
    if(!actor||!['USER','ADMIN'].includes(actor.role))throw new ForbiddenException('Required role missing');
    const id=deviceId(input);deviceId(actor.userId);const timeout=this.timeoutSeconds();
    return this.errors(()=>this.repository.transaction(async tx=>{
      if(actor.role==='USER')await this.ownership.verifyOwnershipInTransaction(tx.ownership,actor.userId,id);
      else{
        if(!await tx.ownership.devices.findDeviceById(id))throw new NotFoundException('Device not found');
        const user=await tx.ownership.devices.users.findByIdForUpdate(actor.userId);
        const roles=user?await tx.ownership.devices.users.findUserRoles(actor.userId):[];
        if(!user||user.status!=='active'||user.email_verified_at===null||roles.length!==1||roles[0].code!=='ADMIN')throw new ForbiddenException('Active verified ADMIN required');
      }
      const presence=await tx.presence(id);if(!presence)throw new NotFoundException('Device not found');
      const connectionStatus=calculateDeviceStatus(presence.lastSeenAt,presence.now,timeout);
      if(connectionStatus==='offline')await tx.markDeviceOffline(id,presence.now,timeout);
      return {deviceId:id,connectionStatus,lastSeenAt:presence.lastSeenAt,telemetry:await tx.telemetry(id)};
    }));
  }
  async markExpiredDevicesOffline(){return this.errors(()=>this.repository.markExpiredDevicesOffline(this.timeoutSeconds()));}
  private async errors<T>(work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof HttpException)throw error;
      if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((error as {code?:string})?.code??''))throw new ConflictException('MONITORING_RETRY');
      throw new InternalServerErrorException('MONITORING_UNAVAILABLE');}
  }
}
