import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { CurrentUser } from '../auth/access-role.guard';
import { QuotasRepository, QuotaTransaction } from './quotas.repository';
import { admissionInput, policyInput, policyMode, quotaId, reportInput, requestId, statisticsInput } from './dto/quota.dto';
import { AdmissionInput, QuotaPolicy, QuotaTotals, UsageRow } from './quotas.types';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const floor = (n: bigint) => (n < 0n ? 0n : n).toString();
const deny = (status: number, reason: string, id?: string) => new HttpException({allowed:false,...(id?{requestId:id}:{}),reason},status);

@Injectable()
export class QuotasService {
  constructor(private readonly repo: QuotasRepository, private readonly providers: AiProvidersService, private readonly config: ConfigService) {}
  reportTimeoutSeconds(): number {
    const value=this.config.get<string>('AI_USAGE_REPORT_TIMEOUT_SECONDS');
    if(!value || !/^[1-9][0-9]*$/.test(value) || Number(value)>2147483) throw new ConflictException('USAGE_REPORT_TIMEOUT_NOT_CONFIGURED');
    return Number(value);
  }
  private async database<T>(work: ()=>Promise<T>): Promise<T> {
    try {await this.repo.assertSchema();return await work();}
    catch(e){if(e instanceof HttpException) throw e;
      if(['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((e as {code?:string})?.code??'')) throw new ConflictException('QUOTA_REQUEST_CONFLICT');
      throw new InternalServerErrorException('QUOTA_UNAVAILABLE');}
  }
  private async user(tx: QuotaTransaction,userId: string,role='USER',active=true) {
    const u=await tx.ai.users.findByIdForUpdate(userId),roles=u?await tx.ai.users.findUserRoles(userId):[];
    if(!u) throw new NotFoundException('USER_NOT_FOUND');
    if(roles.length!==1 || roles[0].code!==role || active && (u.status!=='active'||u.email_verified_at===null)) throw new ForbiddenException('USER_ACCESS_DENIED');
  }
  private policy(rows: QuotaPolicy[]): QuotaPolicy {
    if(!rows.length) throw deny(403,'QUOTA_POLICY_MISSING');
    if(rows.length!==1) throw new ConflictException('AMBIGUOUS_QUOTA_POLICY');
    policyMode(rows[0]);return rows[0];
  }
  private remaining(p: QuotaPolicy,t: QuotaTotals) {
    const mode=policyMode(p);
    if(mode==='BLOCKED') return {requestsPerMinute:'0',requestsPerDay:'0',tokensPerMonth:'0'};
    return {requestsPerMinute:p.requestsPerMinute===null?null:floor(BigInt(p.requestsPerMinute)-BigInt(t.minuteRequests)),
      requestsPerDay:p.requestsPerDay===null?null:floor(BigInt(p.requestsPerDay)-BigInt(t.dayRequests)),
      tokensPerMonth:p.tokensPerMonth===null?null:BigInt(t.unboundedRequests)>0n?null:floor(BigInt(p.tokensPerMonth)-BigInt(t.monthTokens)-BigInt(t.reservedTokens))};
  }
  private async replay(tx: QuotaTransaction,row: UsageRow,now: Date) {
    if(!row.finalizedAt && row.status==='admitted' && row.reportDueAt && row.reportDueAt<=now) {
      await tx.markMissing(row);row={...row,status:'report_missing'};
      await tx.audit(null,'AI_USAGE_REPORT_MISSING',row.id,{requestId:row.requestId,userId:row.userId});
    }
    return {allowed:false as const,requestId:row.requestId,providerId:row.providerId,replayed:true as const,executionAllowed:false as const,
      state:row.status.toUpperCase(),reason:row.finalizedAt?'REQUEST_FINALIZED':row.status==='report_missing'?'USAGE_REPORT_MISSING':'REQUEST_ALREADY_ADMITTED'};
  }
  async authorizeAIRequest(body: unknown) {
    if(this.config.get<string>('AI_QUOTA_CONTRACT_APPROVED')!=='true') throw deny(403,'CONTRACT_NOT_APPROVED');
    const timeout=this.reportTimeoutSeconds(),input=admissionInput(body),fingerprint=hash(input);
    const result=await this.database(()=>this.repo.transaction(async tx=>{
      // Global user lock serializes all devices/providers and the 12/60s ceiling.
      if(input.deviceId && !await tx.ai.ownership.devices.findDeviceById(input.deviceId)) throw new NotFoundException('DEVICE_NOT_FOUND');
      await this.user(tx,input.userId);
      const now=await tx.now(),previous=await tx.request(input.requestId);
      if(previous){
        if(previous.fingerprint!==fingerprint) throw new ConflictException('REQUEST_CONTEXT_CONFLICT');
        return {value:await this.replay(tx,previous,now)};
      }
      // Denials are audited and committed; only pre-write validation is caught here.
      let prepared: {policy:QuotaPolicy;permission:Awaited<ReturnType<AiProvidersService['checkProviderPermission']>>;conversationId:string|null;totals:QuotaTotals;globalUsed:bigint};
      try {
        if(input.deviceId && !await tx.ai.ownership.verifyDeviceOwnership(input.userId,input.deviceId)) throw deny(403,'DEVICE_ACCESS_DENIED',input.requestId);
        const conversationId=await tx.context(input);
        const permission=await this.providers.checkProviderPermission(tx.ai,input.userId,input.providerId,input.modelId);
        const policy=this.policy(await tx.policies(input.userId,input.providerId)),mode=policyMode(policy);
        if(mode==='BLOCKED') throw deny(403,'QUOTA_BLOCKED',input.requestId);
        const totals=await tx.totals(input.userId,input.providerId,now),globalUsed=BigInt(await tx.userMinuteRequests(input.userId,now));
        if(globalUsed>=12n || policy.requestsPerMinute!==null && BigInt(totals.minuteRequests)>=BigInt(policy.requestsPerMinute)
          || policy.requestsPerDay!==null && BigInt(totals.dayRequests)>=BigInt(policy.requestsPerDay)) throw deny(429,'QUOTA_EXCEEDED',input.requestId);
        if(policy.tokensPerMonth!==null){
          if(input.maxTotalTokens===null) throw deny(400,'TOKEN_RESERVATION_REQUIRED',input.requestId);
          if(BigInt(totals.unboundedRequests)>0n) throw deny(409,'UNBOUNDED_REQUESTS_IN_FLIGHT',input.requestId);
          if(BigInt(totals.monthTokens)+BigInt(totals.reservedTokens)+BigInt(input.maxTotalTokens)>BigInt(policy.tokensPerMonth)
            || BigInt(totals.monthTokens)+BigInt(totals.reservedTokens)>=BigInt(policy.tokensPerMonth)) throw deny(429,'QUOTA_EXCEEDED',input.requestId);
        }
        prepared={policy,permission,conversationId,totals,globalUsed};
      } catch(e){
        if(!(e instanceof HttpException)) throw e;
        await tx.audit(null,'AI_REQUEST_DENIED',null,{requestId:input.requestId,userId:input.userId,providerId:input.providerId,status:e.getStatus()});
        return {error:e};
      }
      const {policy,permission,conversationId,totals,globalUsed}=prepared,due=new Date(now.getTime()+timeout*1000);
      await tx.admit(input,fingerprint,policy.id,permission.credentialReference?.id??null,conversationId,now,due);
      await tx.audit(null,'AI_REQUEST_ADMITTED',input.requestId,{requestId:input.requestId,userId:input.userId,providerId:input.providerId,policyId:policy.id});
      const remaining=this.remaining(policy,{...totals,minuteRequests:(BigInt(totals.minuteRequests)+1n).toString(),
        dayRequests:(BigInt(totals.dayRequests)+1n).toString(),reservedTokens:(BigInt(totals.reservedTokens)+BigInt(input.maxTotalTokens??'0')).toString()});
      const globalRemaining=12n-globalUsed-1n;
      remaining.requestsPerMinute=remaining.requestsPerMinute===null ? globalRemaining.toString() : (BigInt(remaining.requestsPerMinute)<globalRemaining?remaining.requestsPerMinute:globalRemaining.toString());
      return {value:{allowed:true as const,requestId:input.requestId,providerId:input.providerId,mode:policyMode(policy),remainingQuota:remaining,
        reservedTokens:input.maxTotalTokens,reportDueAt:due.toISOString(),replayed:false as const,executionAllowed:true as const}};
    }));
    if('error' in result) throw result.error;return result.value;
  }
  async recordAIUsage(body: unknown) {
    const report=reportInput(body),fingerprint=hash(report);
    return this.database(async()=>{
      const located=await this.repo.locateRequest(report.requestId);if(!located) throw new NotFoundException('REQUEST_NOT_FOUND');
      return this.repo.transaction(async tx=>{
        // Settlement intentionally does not recheck active/verified/key/device/contract.
        await tx.ai.users.findByIdForUpdate(located.userId);
        const row=await tx.request(report.requestId);if(!row) throw new NotFoundException('REQUEST_NOT_FOUND');
        if(row.providerId!==report.providerId) throw new ConflictException('USAGE_CONTEXT_CONFLICT');
        const exceeded=row.reservedTokens!==null && BigInt(report.inputTokens)+BigInt(report.outputTokens)>BigInt(row.reservedTokens);
        if(row.finalizedAt){if(row.reportFingerprint!==fingerprint) throw new ConflictException('USAGE_REPORT_CONFLICT');
          return {requestId:report.requestId,status:report.status.toUpperCase(),recorded:true,replayed:true,budgetExceeded:exceeded};}
        await tx.finalize(row,report,fingerprint,await tx.now());
        await tx.audit(null,'AI_USAGE_RECORDED',row.id,{requestId:row.requestId,userId:row.userId,providerId:row.providerId,status:report.status});
        if(exceeded) await tx.audit(null,'AI_TOKEN_BUDGET_EXCEEDED',row.id,{requestId:row.requestId,userId:row.userId});
        return {requestId:report.requestId,status:report.status.toUpperCase(),recorded:true,replayed:false,budgetExceeded:exceeded};
      });
    });
  }
  async markMissingReports() {
    return this.database(async()=>{
      let marked=0;
      for(const id of await this.repo.overdueRequestIds()){
        const located=await this.repo.locateRequest(id);if(!located) continue;
        marked+=await this.repo.transaction(async tx=>{
          await tx.ai.users.findByIdForUpdate(located.userId);const row=await tx.request(id),now=await tx.now();
          if(!row || row.finalizedAt || row.status!=='admitted' || !row.reportDueAt || row.reportDueAt>now) return 0;
          await this.replay(tx,row,now);return 1;
        });
      }
      return {marked};
    });
  }
  private admin(actor: CurrentUser) {if(!actor || actor.role!=='ADMIN') throw new ForbiddenException('ADMIN_REQUIRED');return quotaId(actor.userId);}
  private async policyContext(tx: QuotaTransaction,actorId: string,userId: string,providerId: string) {
    // Every policy writer takes the same target-user lock as admission.
    for(const id of [...new Set([actorId,userId])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)) await this.user(tx,id,id===actorId?'ADMIN':'USER',id===actorId);
    if(!await tx.ai.provider(providerId)) throw new NotFoundException('PROVIDER_NOT_FOUND');
  }
  async getQuotaPolicy(actor: CurrentUser,userId: string,providerId: string) {
    const actorId=this.admin(actor);userId=quotaId(userId);providerId=quotaId(providerId);
    return this.database(()=>this.repo.transaction(async tx=>{
      await this.policyContext(tx,actorId,userId,providerId);const rows=await tx.policies(userId,providerId);
      if(!rows.length) return {userId,providerId,policyId:null,mode:null,policyStatus:'MISSING'};
      const p=this.policy(rows);return {userId,providerId,policyId:p.id,mode:policyMode(p),requestsPerMinute:p.requestsPerMinute,requestsPerDay:p.requestsPerDay,tokensPerMonth:p.tokensPerMonth};
    }));
  }
  async updateQuotaPolicy(actor: CurrentUser,userId: string,providerId: string,body: unknown) {
    const actorId=this.admin(actor),input=policyInput(body);userId=quotaId(userId);providerId=quotaId(providerId);
    return this.database(()=>this.repo.transaction(async tx=>{
      await this.policyContext(tx,actorId,userId,providerId);const rows=await tx.policies(userId,providerId);
      if(rows.length>1) throw new ConflictException('AMBIGUOUS_QUOTA_POLICY');
      if((rows[0]?.id??null)!==input.expectedPolicyId) throw new ConflictException('QUOTA_POLICY_CHANGED');
      const now=await tx.now();if(input.tokensPerMonth!==null && input.mode==='LIMITED' && BigInt((await tx.totals(userId,providerId,now)).unboundedRequests)>0n) throw new ConflictException('UNBOUNDED_REQUESTS_IN_FLIGHT');
      const policyId=await tx.replacePolicy(userId,providerId,input,now);
      await tx.audit(actorId,'AI_QUOTA_POLICY_CHANGED',policyId,{userId,providerId,previousPolicyId:input.expectedPolicyId});
      return {userId,providerId,policyId,mode:input.mode,requestsPerMinute:input.requestsPerMinute,requestsPerDay:input.requestsPerDay,tokensPerMonth:input.tokensPerMonth};
    }));
  }
  async getUsageStatistics(actor: CurrentUser,query: Record<string,unknown>) {
    if(!actor || !['ADMIN','USER'].includes(actor.role)) throw new ForbiddenException();
    const input=statisticsInput(query,actor.role==='ADMIN'),userId=actor.role==='USER'?quotaId(actor.userId):input.userId;
    return this.database(()=>this.repo.transaction(async tx=>{
      await this.user(tx,actor.userId,actor.role);const now=await tx.now();
      const from=input.from??new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),to=input.to??new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
      const totals=await tx.statistics(userId,input.providerId,from,to);
      const result={...totals,policyStatus:'NOT_SCOPED',mode:null as string|null,quotaLimit:null as unknown,remainingQuota:null as unknown,
        range:{from:from.toISOString(),to:to.toISOString()},quotaWindowAt:now.toISOString(),quotaUnboundedRequests:'0',admissionBlockedByUnboundedRequests:false};
      if(userId && input.providerId){
        if(userId!==actor.userId) await this.user(tx,userId,'USER',false);
        const rows=await tx.policies(userId,input.providerId);if(!rows.length) return {...result,policyStatus:'MISSING'};
        const p=this.policy(rows),t=await tx.totals(userId,input.providerId,now),mode=policyMode(p);
        return {...result,policyStatus:'READY',mode,quotaLimit:{requestsPerMinute:p.requestsPerMinute,requestsPerDay:p.requestsPerDay,tokensPerMonth:p.tokensPerMonth},remainingQuota:this.remaining(p,t),
          quotaUnboundedRequests:t.unboundedRequests,admissionBlockedByUnboundedRequests:mode==='LIMITED' && p.tokensPerMonth!==null && BigInt(t.unboundedRequests)>0n};
      }
      return result;
    }));
  }
}
