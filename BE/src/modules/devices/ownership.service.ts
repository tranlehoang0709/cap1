import { ConflictException, ForbiddenException, HttpException, Injectable,
  InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/access-role.guard';
import { deviceId } from './dto/device-query.dto';
import { authorizationInput, renameInput } from './dto/ownership.dto';
import { OwnershipRepository, OwnershipTransaction } from './ownership.repository';

@Injectable()
export class OwnershipService {
  constructor(private readonly repository:OwnershipRepository,private readonly config:ConfigService) {}
  private user(actor:CurrentUser):string {
    if (!actor || actor.role!=='USER') throw new ForbiddenException('USER role required');
    return deviceId(actor.userId);
  }
  async getUserDevices(actor:CurrentUser) {
    const userId=this.user(actor);
    return this.database(async()=>{const devices=await this.repository.getUserDevices(userId);return {devices,total:devices.length};});
  }
  async canAccessDashboard(actor:CurrentUser) {
    const userId=this.user(actor);
    return this.database(async()=>{
      const allowed=await this.repository.canAccessDashboard(userId);
      return {allowed,reason:allowed?null:'NO_APPROVED_DEVICE'};
    });
  }
  async verifyOwnershipInTransaction(tx:OwnershipTransaction,userId:string,id:string) {
    const device=await tx.devices.findDeviceById(id);
    if (!device) throw new NotFoundException('Device not found');
    const assignment=await tx.devices.getActiveAssignment(id);
    // Avoid leaking whether another User's device exists.
    if (!assignment || assignment.userId!==userId) throw new NotFoundException('Device not found');
    const user=await tx.devices.users.findByIdForUpdate(userId);
    const roles=user?await tx.devices.users.findUserRoles(userId):[];
    if (!user || user.status!=='active' || user.email_verified_at===null || roles.length!==1 || roles[0].code!=='USER') {
      throw new ForbiddenException('Active verified USER required');
    }
    const owned=await tx.verifyDeviceOwnership(userId,id);
    if (!owned) throw new ConflictException('Device access is blocked');
    return owned;
  }
  async verifyDeviceOwnership(actor:CurrentUser,input:unknown) {
    const userId=this.user(actor);const id=deviceId(input);
    return this.database(()=>this.repository.withTransaction(tx=>this.verifyOwnershipInTransaction(tx,userId,id)));
  }
  async renameUserDevice(actor:CurrentUser,input:unknown,body:unknown) {
    const userId=this.user(actor);const id=deviceId(input);const name=renameInput(body);
    return this.database(()=>this.repository.withTransaction(async tx=>{
      await this.verifyOwnershipInTransaction(tx,userId,id);
      await tx.renameUserDevice(id,userId,name);
      return {id,displayName:name};
    }));
  }
  async authorizeDeviceConnection(body:unknown) {
    // Also gate direct service invocation. This flag is not proof of external agreement.
    if (this.config.get<string>('DEVICE_AUTH_CONTRACT_APPROVED')!=='true') {
      throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    }
    const {deviceUid,credential}=authorizationInput(body);
    return this.database(()=>this.repository.withTransaction(async tx=>{
      return this.validateAuthorizedDevice(tx,deviceUid,credential);
    }),true);
  }
  /** Reuse on the caller's transaction so authorization and heartbeat cannot race revoke. */
  async validateAuthorizedDevice(tx:OwnershipTransaction,deviceUid:string,credential:string,unknownDeviceStatus:401|404=401) {
    const hash=createHash('sha256').update(credential,'utf8').digest('hex');
    const id=await tx.findDeviceIdByUid(deviceUid);
    if(!id&&unknownDeviceStatus===404)throw new NotFoundException('Device not found');
    if (!id || !await tx.devices.findDeviceById(id)
      || !await tx.validateDeviceCredential(id,hash)) {
      throw new UnauthorizedException({allowed:false,reason:'DEVICE_UNAUTHORIZED'});
    }
    const assignment=await tx.devices.getActiveAssignment(id);
    if (!assignment) throw new ForbiddenException({allowed:false,reason:'DEVICE_ACCESS_DENIED'});
    const owner=await tx.devices.users.findByIdForUpdate(assignment.userId);
    const roles=owner?await tx.devices.users.findUserRoles(assignment.userId):[];
    if (!owner || owner.status!=='active' || owner.email_verified_at===null
      || roles.length!==1 || roles[0].code!=='USER'
      || !await tx.verifyDeviceOwnership(assignment.userId,id)) {
      throw new ForbiddenException({allowed:false,reason:'DEVICE_ACCESS_DENIED'});
    }
    return {allowed:true as const,deviceId:id,ownerUserId:assignment.userId};
  }
  private async database<T>(operation:()=>Promise<T>,internal=false):Promise<T> {
    try {return await operation();}
    catch(error){
      if(error instanceof HttpException)throw error;
      const code=(error as {code?:string})?.code;
      if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(code??'')) {
        throw new ConflictException(internal?{allowed:false,reason:'AUTHORIZATION_RETRY'}:'Device state changed; refresh before retrying');
      }
      throw new InternalServerErrorException(internal?{allowed:false,reason:'AUTHORIZATION_UNAVAILABLE'}:'Unable to access devices');
    }
  }
}
