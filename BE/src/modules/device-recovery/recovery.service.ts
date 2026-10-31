import { BadRequestException,ConflictException,ForbiddenException,HttpException,Injectable,InternalServerErrorException,NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { CurrentUser } from '../auth/access-role.guard';
import { ackInput,claimInput,recoveryId,revokeInput } from './recovery.dto';
import { BackupContent,RecoveryStore } from './recovery-store';
import { Backup,Operation,RecoveryRepository,RecoveryTransaction,ResetJob } from './recovery.repository';

@Injectable()
export class RecoveryService {
  constructor(private readonly repository:RecoveryRepository,private readonly store:RecoveryStore,private readonly config:ConfigService){}
  private actor(actor:CurrentUser){if(!actor||actor.role!=='ADMIN')throw new ForbiddenException('ADMIN required');recoveryId(actor.userId);}
  private async authorize(tx:RecoveryTransaction,actor:CurrentUser,ownerId?:string,restore=false){
    if(restore&&ownerId===actor.userId)throw new ConflictException('FORMER_OWNER_INELIGIBLE');
    for(const id of [...new Set([actor.userId,...(ownerId?[ownerId]:[])])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)){
      const user=await tx.ownership.devices.users.findByIdForUpdate(id);
      if(id===actor.userId||restore){const roles=user?await tx.ownership.devices.users.findUserRoles(id):[];
        if(!user||user.status!=='active'||user.email_verified_at===null||roles.length!==1||roles[0].code!==(id===actor.userId?'ADMIN':'USER')){
          if(id===actor.userId)throw new ForbiddenException('Active verified ADMIN required');throw new ConflictException('FORMER_OWNER_INELIGIBLE');}}
    }
  }
  private async device(tx:RecoveryTransaction,id:string){const device=await tx.ownership.devices.findDeviceById(id);if(!device)throw new NotFoundException('Device not found');return device;}
  private resetContract(){if(this.config.get<string>('RESET_CONTRACT_APPROVED')!=='true')throw new ForbiddenException({reason:'RESET_CONTRACT_NOT_APPROVED'});}
  private jobResult(job:ResetJob){return {jobId:job.id,deviceId:job.deviceId,status:job.status.toUpperCase(),acknowledgedAt:job.acknowledgedAt};}
  private async revokeResult(tx:RecoveryTransaction,op:Operation){const backup=await tx.backupForOperation(op.id);const job=await tx.latestJob(op.deviceId);
    if(!backup||!job||job.operationId!==op.id)throw new ConflictException('INCOMPLETE_RECOVERY_OPERATION');
    return {operationId:op.id,deviceId:op.deviceId,status:op.status.toUpperCase(),resetStatus:job.status.toUpperCase(),backupExpiresAt:backup.expiresAt};}
  async revokeDeviceAssignment(actor:CurrentUser,input:unknown,body:unknown,idempotencyKey:unknown){
    this.actor(actor);const deviceId=recoveryId(input);const {reason,key}=revokeInput(body,idempotencyKey);
    const settingKey=`recovery.revoke.${actor.userId}.${createHash('sha256').update(key).digest('hex')}`;
    const fingerprint=createHash('sha256').update(JSON.stringify({deviceId,reason})).digest('hex');
    return this.errors(()=>this.repository.transaction(async tx=>{
      await this.device(tx,deviceId);const assignment=await tx.assignment(deviceId);await this.authorize(tx,actor,assignment?.userId);
      const existing=await tx.setting(settingKey) as {fingerprint:string;operationId:string}|null;
      if(existing){if(existing.fingerprint!==fingerprint)throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        const op=await tx.operation(existing.operationId);if(!op||op.deviceId!==deviceId)throw new ConflictException('INVALID_OPERATION_REFERENCE');return this.revokeResult(tx,op);}
      const latest=await tx.latestOperation(deviceId);
      if(!assignment){if(!latest)throw new ConflictException('DEVICE_NOT_ASSIGNED');
        await tx.saveSetting(settingKey,{fingerprint,operationId:latest.id},actor.userId);return this.revokeResult(tx,latest);}
      if(latest&&latest.status!=='completed')throw new ConflictException('RESET_ALREADY_PENDING');
      if(!await tx.assignmentApproved(assignment))throw new ConflictException('INVALID_ASSIGNMENT');
      const now=await tx.now();const historyId=await tx.history(assignment);
      const operationId=await tx.createOperation(deviceId,assignment.userId,historyId,actor.userId,now);
      const content:BackupContent={version:1,deviceId,formerUserId:assignment.userId,displayName:await tx.displayName(deviceId),
        assignment:{userId:assignment.userId,pairingRequestId:assignment.pairingRequestId,assignedBy:assignment.assignedBy,assignedAt:assignment.assignedAt.toISOString()}};
      const stored=await this.store.createRecoveryBackup(content,operationId);
      const backupId=await tx.insertBackup(operationId,stored,now);
      await tx.revoke(assignment,historyId,operationId,actor.userId,reason,now);
      await tx.saveSetting(settingKey,{fingerprint,operationId},actor.userId);
      await tx.audit(actor.userId,'DEVICE_ASSIGNMENT_REVOKED',operationId,{deviceId,formerUserId:assignment.userId,backupId,reason});
      const op=await tx.operation(operationId);if(!op)throw new ConflictException('INCOMPLETE_RECOVERY_OPERATION');
      return this.revokeResult(tx,op);
    }));
  }
  async getRecovery(actor:CurrentUser,input:unknown){this.actor(actor);const deviceId=recoveryId(input);
    return this.errors(()=>this.repository.transaction(async tx=>{await this.device(tx,deviceId);await this.authorize(tx,actor);
      return {backups:(await tx.backups(deviceId)).map(b=>({backupId:b.id,operationId:b.operationId,deviceId:b.deviceId,createdAt:b.createdAt,
        expiresAt:b.expiresAt,deletedAt:b.deletedAt,restoredAt:b.restoredAt}))};}));}
  async getResetStatus(actor:CurrentUser,input:unknown){this.actor(actor);const deviceId=recoveryId(input);
    return this.errors(()=>this.repository.transaction(async tx=>{await this.device(tx,deviceId);await this.authorize(tx,actor);
      const job=await tx.latestJob(deviceId);if(!job)throw new NotFoundException('Reset job not found');return this.jobResult(job);}));}
  async requestDeviceReset(body:unknown){
    this.resetContract();const deviceId=claimInput(body);const raw=this.config.get<string>('DEVICE_RESET_RETRY_SECONDS');
    if(!raw||!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>2147483)throw new ConflictException('RESET_RETRY_NOT_CONFIGURED');
    const lease=Number(raw);
    return this.errors(()=>this.repository.transaction(async tx=>{const device=await this.device(tx,deviceId);
      const job=await tx.latestJob(deviceId);const op=await tx.latestOperation(deviceId);
      if(!job||!op||job.operationId!==op.id)throw new NotFoundException('Reset job not found');
      if(job.status==='acknowledged')return {claimed:false,...this.jobResult(job)};
      if(await tx.assignment(deviceId))throw new ConflictException('DEVICE_HAS_OWNER');
      if(device.lifecycleStatus!=='reset_pending')throw new ConflictException('INVALID_RESET_STATE');
      if(!['reset_pending','failed'].includes(op.status)||!['pending','sent','failed'].includes(job.status))throw new ConflictException('INVALID_RESET_STATE');
      const now=await tx.now();const retryAfter=job.sentAt?Math.ceil(lease-(now.getTime()-job.sentAt.getTime())/1000):0;
      if(retryAfter>0)return {claimed:false,...this.jobResult(job),retryAfterSeconds:retryAfter};
      if(job.attempt>=2147483647)throw new ConflictException('RESET_ATTEMPT_LIMIT');
      const challenge=randomBytes(32).toString('base64url');await tx.claim(job,createHash('sha256').update(challenge).digest('hex'),now);
      await tx.audit(null,'DEVICE_RESET_DISPATCHED',job.id,{deviceId,operationId:op.id,attempt:job.attempt+1});
      return {claimed:true,jobId:job.id,deviceId,operationId:op.id,status:'SENT',attempt:job.attempt+1,challenge,
        actions:['INVALIDATE_SESSIONS','RESET_USER_CONFIGURATION']};
    }));
  }
  async processResetAcknowledgment(input:unknown,body:unknown){
    this.resetContract();const jobId=recoveryId(input);const ack=ackInput(body);
    return this.errors(()=>this.repository.transaction(async tx=>{const device=await this.device(tx,ack.deviceId);
      const job=await tx.job(jobId);const latest=await tx.latestJob(ack.deviceId);const op=await tx.latestOperation(ack.deviceId);
      if(!job||job.deviceId!==ack.deviceId)throw new NotFoundException('Reset job not found');
      if(!latest||latest.id!==job.id||!op||op.id!==job.operationId||job.attempt!==ack.attempt)throw new ConflictException('STALE_RESET_ACK');
      const state=await tx.setting(`recovery.reset.${job.id}.challenge`) as {hash?:string;attempt?:number}|null;
      const proof=createHash('sha256').update(ack.challenge).digest();
      if(!state||state.attempt!==ack.attempt||typeof state.hash!=='string'||!/^[a-f0-9]{64}$/.test(state.hash)
        ||!timingSafeEqual(proof,Buffer.from(state.hash,'hex')))throw new ForbiddenException('INVALID_RESET_PROOF');
      if(job.status==='acknowledged'){if(ack.result!=='success')throw new ConflictException('RESET_ALREADY_ACKNOWLEDGED');return this.jobResult(job);}
      if(job.status==='failed'){if(ack.result==='failed'&&job.lastError===ack.failureCode)return this.jobResult(job);throw new ConflictException('RESET_ATTEMPT_ALREADY_HANDLED');}
      if(job.status!=='sent'||!job.sentAt||await tx.assignment(ack.deviceId)||device.lifecycleStatus!=='reset_pending'||!['reset_pending','failed'].includes(op.status))throw new ConflictException('INVALID_RESET_STATE');
      const now=await tx.now();if(now<job.sentAt||(op.revokedAt&&now<op.revokedAt))throw new ConflictException('RESET_CLOCK_CONFLICT');
      const success=ack.result==='success';await tx.acknowledge(job,success,ack.failureCode??null,now);
      await tx.audit(null,success?'DEVICE_RESET_ACKNOWLEDGED':'DEVICE_RESET_FAILED',job.id,{deviceId:ack.deviceId,operationId:op.id,attempt:ack.attempt});
      return {...this.jobResult(job),status:success?'ACKNOWLEDGED':'FAILED',acknowledgedAt:success?now:null};
    }));
  }
  private validateContent(content:BackupContent,backup:Backup){
    try{if(content.version!==1||content.deviceId!==backup.deviceId||content.formerUserId!==backup.formerUserId
      ||content.assignment.userId!==backup.formerUserId||(content.displayName!==null&&(typeof content.displayName!=='string'||[...content.displayName].length>120)))throw new Error();
      recoveryId(content.assignment.pairingRequestId);recoveryId(content.assignment.assignedBy);
    }catch{throw new ConflictException('INVALID_BACKUP_CONTENT');}
  }
  async restoreDeviceAssignment(actor:CurrentUser,input:unknown){this.actor(actor);const backupId=recoveryId(input);
    return this.errors(()=>this.repository.transaction(async tx=>{
      const candidate=await tx.backup(backupId,false);if(!candidate)throw new NotFoundException('Backup not found');
      const device=await this.device(tx,candidate.deviceId);await this.authorize(tx,actor,candidate.formerUserId,true);
      const backup=await tx.backup(backupId);if(!backup||backup.deviceId!==candidate.deviceId)throw new ConflictException('BACKUP_CHANGED');
      const now=await tx.now();if(backup.deletedAt||backup.expiresAt<=now)throw new ConflictException('BACKUP_EXPIRED');
      const op=await tx.latestOperation(backup.deviceId);const job=await tx.latestJob(backup.deviceId);const assignment=await tx.assignment(backup.deviceId);
      if(!op||op.id!==backup.operationId||op.status!=='completed'||!op.completedAt||!job||job.operationId!==op.id
        ||!op.revokedAt||job.status!=='acknowledged'||!job.acknowledgedAt||job.acknowledgedAt<op.revokedAt
        ||job.acknowledgedAt>now||op.completedAt>now)throw new ConflictException('RESET_NOT_CONFIRMED');
      if(backup.restoredAt){if(assignment?.userId===backup.formerUserId&&device.lifecycleStatus==='assigned')return {deviceId:backup.deviceId,status:'RESTORED',ownerUserId:backup.formerUserId};throw new ConflictException('BACKUP_ALREADY_RESTORED');}
      if(assignment)throw new ConflictException('DEVICE_HAS_OWNER');if(device.lifecycleStatus!=='available')throw new ConflictException('DEVICE_NOT_RESTORABLE');
      const content=await this.store.read(backup,backup.deviceId,backup.operationId);this.validateContent(content,backup);
      if(!await tx.assignmentApproved({deviceId:backup.deviceId,userId:backup.formerUserId,pairingRequestId:content.assignment.pairingRequestId,assignedBy:actor.userId,assignedAt:now}))throw new ConflictException('ORIGINAL_APPROVAL_INVALID');
      const restoredNow=await tx.now();if(backup.expiresAt<=restoredNow)throw new ConflictException('BACKUP_EXPIRED');
      await tx.restore(backup,content,actor.userId,restoredNow);await tx.audit(actor.userId,'DEVICE_ASSIGNMENT_RESTORED',backup.id,{deviceId:backup.deviceId,ownerUserId:backup.formerUserId,operationId:backup.operationId});
      return {deviceId:backup.deviceId,status:'RESTORED',ownerUserId:backup.formerUserId};
    }));}
  async cleanupExpiredBackups(){
    let deletedCount=0;
    for(const id of await this.repository.expiredIds()){
      const removed=await this.errors(()=>this.repository.transaction(async tx=>{
        const candidate=await tx.backup(id,false);if(!candidate)return false;await this.device(tx,candidate.deviceId);
        const backup=await tx.backup(id);const now=await tx.now();if(!backup||backup.deletedAt||backup.expiresAt>now)return false;
        await this.store.remove(backup.uri);await tx.markDeleted(id,now);await tx.audit(null,'DEVICE_RECOVERY_BACKUP_EXPIRED',id,{deviceId:backup.deviceId,operationId:backup.operationId});return true;
      }));if(removed)deletedCount++;
    }
    const now=await this.repository.transaction(tx=>tx.now());let orphanCount=0;
    for(const uri of await this.store.orphanCandidates(now))if(!await this.repository.referenced(uri)){await this.store.remove(uri);orphanCount++;}
    return {deletedCount,orphanCount};
  }
  private async errors<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof HttpException)throw error;
    if(['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((error as {code?:string})?.code??''))throw new ConflictException('RECOVERY_CONFLICT');
    throw new InternalServerErrorException('RECOVERY_UNAVAILABLE');}}
}
