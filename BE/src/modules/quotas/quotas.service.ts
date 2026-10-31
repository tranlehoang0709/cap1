import { ConflictException,ForbiddenException,HttpException,Injectable,InternalServerErrorException,NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/access-role.guard';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { admissionInput,policyInput,policyMode,quotaId,reportInput,statisticsInput } from './dto/quota.dto';
import { QuotasRepository,QuotaTransaction } from './quotas.repository';
import { AdmissionInput,QuotaPolicy,QuotaTotals,UsageRow } from './quotas.types';

@Injectable()
export class QuotasService {
  constructor(private readonly repository:QuotasRepository,private readonly providers:AiProvidersService,private readonly config:ConfigService){}
  private role(actor:CurrentUser,role:'USER'|'ADMIN'){if(!actor||actor.role!==role)throw new ForbiddenException('Required role missing');quotaId(actor.userId);}
  private async user(tx:QuotaTransaction,id:string,role:'USER'|'ADMIN',active=true){
    const user=await tx.ai.users.findByIdForUpdate(id);if(!user)throw new NotFoundException('User not found');
    const roles=await tx.ai.users.findUserRoles(id);
    if(roles.length!==1||roles[0].code!==role||(active&&(user.status!=='active'||user.email_verified_at===null)))throw new ForbiddenException('Active verified account with the required role is required');
  }
  private async adminAndTarget(tx:QuotaTransaction,actor:CurrentUser,target:string|null){
    for(const id of [...new Set([actor.userId,...(target?[target]:[])])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)){
      await this.user(tx,id,id===actor.userId?'ADMIN':'USER',id===actor.userId);
    }
    if(target===actor.userId)throw new ConflictException('Target must be a USER account');
  }
  reportTimeoutSeconds():number{
    const value=this.config.get<string>('AI_USAGE_REPORT_TIMEOUT_SECONDS');
    if(!value||!/^\d+$/.test(value)||Number(value)<1||Number(value)>2147483)throw new ConflictException('USAGE_REPORT_TIMEOUT_NOT_CONFIGURED');
    return Number(value);
  }
  private hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
  private async run<T>(work:(tx:QuotaTransaction)=>Promise<T>):Promise<T>{return this.errors(async()=>{await this.repository.assertSchema();return this.repository.transaction(work);});}
  private async errors<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){
    if(error instanceof HttpException)throw error;
    if(['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((error as {code?:string})?.code??''))throw new ConflictException('QUOTA_REQUEST_CONFLICT');
    throw new InternalServerErrorException('QUOTA_UNAVAILABLE');}}
  private policy(rows:QuotaPolicy[]):QuotaPolicy{
    if(!rows.length)throw new ForbiddenException('QUOTA_POLICY_MISSING');
    if(rows.length!==1)throw new ConflictException('QUOTA_POLICY_AMBIGUOUS');
    policyMode(rows[0]);return rows[0];
  }
  async resolveQuotaPolicy(tx:QuotaTransaction,userId:string,providerId:string){return this.policy(await tx.policies(userId,providerId));}
  private limits(p:QuotaPolicy){return {requestsPerMinute:p.requestsPerMinute,requestsPerDay:p.requestsPerDay,tokensPerMonth:p.tokensPerMonth};}
  private remaining(p:QuotaPolicy,t:QuotaTotals){
    const left=(limit:number|string|null,used:bigint)=>limit===null?null:(BigInt(limit)>used?BigInt(limit)-used:0n).toString();
    return {requestsPerMinute:left(p.requestsPerMinute,BigInt(t.minuteRequests)),requestsPerDay:left(p.requestsPerDay,BigInt(t.dayRequests)),
      tokensPerMonth:p.tokensPerMonth!==null&&p.tokensPerMonth!=='0'&&t.unboundedRequests!=='0'?null:left(p.tokensPerMonth,BigInt(t.monthTokens)+BigInt(t.reservedTokens))};
  }
  async getQuotaPolicy(actor:CurrentUser,userInput:unknown,providerInput:unknown){
    this.role(actor,'ADMIN');const userId=quotaId(userInput),providerId=quotaId(providerInput);
    return this.run(async tx=>{await this.adminAndTarget(tx,actor,userId);if(!await tx.ai.provider(providerId))throw new NotFoundException('Provider not found');
      const rows=await tx.policies(userId,providerId);
      if(rows.length>1)throw new ConflictException({message:'QUOTA_POLICY_AMBIGUOUS',activePolicyIds:rows.map(r=>r.id)});
      return rows.length?{userId,providerId,policyId:rows[0].id,mode:policyMode(rows[0]),...this.limits(rows[0])}:
        {userId,providerId,policyId:null,mode:null,policyStatus:'MISSING'};
    });
  }
  async updateQuotaPolicy(actor:CurrentUser,userInput:unknown,providerInput:unknown,body:unknown){
    this.role(actor,'ADMIN');const userId=quotaId(userInput),providerId=quotaId(providerInput),input=policyInput(body);
    return this.run(async tx=>{
      await this.adminAndTarget(tx,actor,userId);if(!await tx.ai.provider(providerId))throw new NotFoundException('Provider not found');
      const current=await tx.policies(userId,providerId);
      if(current.length>1)throw new ConflictException('QUOTA_POLICY_AMBIGUOUS');
      if((current[0]?.id??null)!==input.expectedPolicyId)throw new ConflictException('QUOTA_POLICY_CHANGED');
      const now=await tx.now();
      if(input.mode==='LIMITED'&&input.tokensPerMonth!==null&&(await tx.totals(userId,providerId,now)).unboundedRequests!=='0')throw new ConflictException('UNBOUNDED_REQUESTS_IN_FLIGHT');
      const policyId=await tx.replacePolicy(userId,providerId,input,now);
      await tx.audit(actor.userId,'AI_QUOTA_POLICY_CHANGED',policyId,{userId,providerId,previousPolicyId:current[0]?.id??null,mode:input.mode,
        requestsPerMinute:input.requestsPerMinute,requestsPerDay:input.requestsPerDay,tokensPerMonth:input.tokensPerMonth});
      return {userId,providerId,policyId,mode:input.mode,...this.limits({...input,id:policyId,userId,providerId})};
    });
  }
  enforceRateLimit(p:QuotaPolicy,t:QuotaTotals):boolean{
    return (p.requestsPerMinute===null||BigInt(t.minuteRequests)<BigInt(p.requestsPerMinute))
      &&(p.requestsPerDay===null||BigInt(t.dayRequests)<BigInt(p.requestsPerDay));
  }
  checkQuota(p:QuotaPolicy,t:QuotaTotals,budget:string|null):boolean{
    return this.enforceRateLimit(p,t)&&(p.tokensPerMonth===null||(t.unboundedRequests==='0'&&budget!==null
      &&BigInt(t.monthTokens)+BigInt(t.reservedTokens)+BigInt(budget)<=BigInt(p.tokensPerMonth)));
  }
  private async context(tx:QuotaTransaction,input:AdmissionInput){
    if(input.deviceId){if(!await tx.ai.ownership.devices.findDeviceById(input.deviceId))throw new NotFoundException('Device not found');}
    await this.user(tx,input.userId,'USER');
    if(input.deviceId&&!await tx.ai.ownership.verifyDeviceOwnership(input.userId,input.deviceId))throw new ForbiddenException('DEVICE_ACCESS_DENIED');
    return tx.context(input);
  }
  async authorizeAIRequest(body:unknown){
    if(this.config.get<string>('AI_QUOTA_CONTRACT_APPROVED')!=='true')throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    const input=admissionInput(body),fingerprint=this.hash(input),timeout=this.reportTimeoutSeconds();
    const result=await this.run(async tx=>{
      const deny=async(status:number,reason:string)=>{await tx.audit(null,'AI_REQUEST_DENIED',input.requestId,{userId:input.userId,providerId:input.providerId,reason});return {denial:{status,reason}};};
      let stateChanged=false;
      try{
        const conversationId=await this.context(tx,input);
        const permission=await this.providers.checkProviderPermission(tx.ai,input.userId,input.providerId,input.modelId);
        const now=await tx.now();
        const existing=await tx.request(input.requestId);
        if(existing){
          if(existing.userId!==input.userId||existing.fingerprint!==fingerprint)return deny(409,'REQUEST_CONTEXT_CONFLICT');
          if(!existing.finalizedAt&&existing.reportDueAt&&existing.reportDueAt<=now&&existing.status==='admitted'){
            stateChanged=true;
            await tx.markMissing(existing);await tx.audit(null,'AI_USAGE_REPORT_MISSING',input.requestId,{userId:input.userId,providerId:input.providerId});existing.status='report_missing';
          }
          // A replay returns durable state, never another permission to execute.
          return {allowed:false,requestId:input.requestId,providerId:input.providerId,replayed:true,executionAllowed:false,
            state:existing.status.toUpperCase(),reason:existing.finalizedAt?'REQUEST_FINALIZED':existing.status==='report_missing'?'USAGE_REPORT_MISSING':'REQUEST_ALREADY_ADMITTED'};
        }
        const policy=await this.resolveQuotaPolicy(tx,input.userId,input.providerId);const mode=policyMode(policy);
        if(mode==='BLOCKED')return deny(403,'QUOTA_BLOCKED');
        if(mode==='LIMITED'&&policy.tokensPerMonth!==null&&input.maxTotalTokens===null)return deny(400,'TOKEN_RESERVATION_REQUIRED');
        const totals=await tx.totals(input.userId,input.providerId,now);
        if(mode==='LIMITED'&&!this.checkQuota(policy,totals,input.maxTotalTokens))return deny(429,'QUOTA_EXCEEDED');
        const dueAt=new Date(now.getTime()+timeout*1000);
        stateChanged=true;
        await tx.admit(input,fingerprint,policy.id,permission.credentialReference?.id??null,conversationId,now,dueAt);
        await tx.audit(null,'AI_REQUEST_ADMITTED',input.requestId,{userId:input.userId,providerId:input.providerId,policyId:policy.id,
          reservedTokens:input.maxTotalTokens,credentialScope:permission.credentialScope});
        const used={...totals,minuteRequests:(BigInt(totals.minuteRequests)+1n).toString(),dayRequests:(BigInt(totals.dayRequests)+1n).toString(),
          reservedTokens:(BigInt(totals.reservedTokens)+BigInt(input.maxTotalTokens??'0')).toString()};
        return {allowed:true,requestId:input.requestId,providerId:input.providerId,mode,remainingQuota:this.remaining(policy,used),
          reservedTokens:input.maxTotalTokens,reportDueAt:dueAt,replayed:false,executionAllowed:true};
      }catch(error){if(error instanceof HttpException&&!stateChanged)return deny(error.getStatus(),typeof error.message==='string'?error.message:'AI_REQUEST_FORBIDDEN');throw error;}
    });
    if('denial' in result&&result.denial)throw new HttpException({allowed:false,requestId:input.requestId,reason:result.denial.reason},result.denial.status);
    return result;
  }
  async recordAIUsage(body:unknown){
    const usage=reportInput(body),hash=this.hash(usage);
    return this.run(async tx=>{
      const candidate=await tx.request(usage.requestId,false);if(!candidate)throw new NotFoundException('AI request not found');
      // Settlement is allowed after account/device/key revoke, not new execution.
      if(!await tx.ai.users.findByIdForUpdate(candidate.userId))throw new NotFoundException('User not found');
      const request=await tx.request(usage.requestId);if(!request||request.userId!==candidate.userId||request.providerId!==usage.providerId)throw new ConflictException('USAGE_CONTEXT_CONFLICT');
      if(request.finalizedAt){if(request.reportFingerprint!==hash)throw new ConflictException('USAGE_REPORT_CONFLICT');
        return {requestId:usage.requestId,status:request.status.toUpperCase(),recorded:true,replayed:true,
          budgetExceeded:request.reservedTokens!==null&&BigInt(usage.inputTokens)+BigInt(usage.outputTokens)>BigInt(request.reservedTokens)};}
      if(!['admitted','report_missing'].includes(request.status))throw new ConflictException('INVALID_USAGE_STATE');
      const now=await tx.now();await tx.finalize(request,usage,hash,now);
      const overrun=request.reservedTokens!==null&&BigInt(usage.inputTokens)+BigInt(usage.outputTokens)>BigInt(request.reservedTokens);
      await tx.audit(null,'AI_USAGE_RECORDED',usage.requestId,{userId:request.userId,providerId:request.providerId,status:usage.status,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens});
      if(overrun)await tx.audit(null,'AI_TOKEN_BUDGET_EXCEEDED',usage.requestId,{userId:request.userId,providerId:request.providerId,reservedTokens:request.reservedTokens});
      return {requestId:usage.requestId,status:usage.status.toUpperCase(),recorded:true,replayed:false,budgetExceeded:overrun};
    });
  }
  async markMissingReports(){
    await this.repository.assertSchema();let marked=0;
    for(const requestId of await this.repository.overdueRequestIds()){
      const updated=await this.run(async tx=>{const candidate=await tx.request(requestId,false);if(!candidate)return false;
        if(!await tx.ai.users.findByIdForUpdate(candidate.userId))return false;
        const row=await tx.request(requestId);const now=await tx.now();
        if(!row||row.finalizedAt||row.status!=='admitted'||!row.reportDueAt||row.reportDueAt>now)return false;
        await tx.markMissing(row);await tx.audit(null,'AI_USAGE_REPORT_MISSING',requestId,{userId:row.userId,providerId:row.providerId});return true;});
      if(updated)marked++;
    }return {marked};
  }
  async getUsageStatistics(actor:CurrentUser,query:Record<string,unknown>){
    if(!actor||!['ADMIN','USER'].includes(actor.role))throw new ForbiddenException('Required role missing');quotaId(actor.userId);
    const input=statisticsInput(query,actor.role==='ADMIN');const userId=actor.role==='USER'?actor.userId:input.userId;
    return this.run(async tx=>{
      if(actor.role==='USER')await this.user(tx,actor.userId,'USER');else await this.adminAndTarget(tx,actor,userId);
      const now=await tx.now(),from=input.from??new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),to=input.to??new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
      const statistics=await tx.statistics(userId,input.providerId,from,to);
      let quota:object={policyStatus:'NOT_SCOPED',mode:null,quotaLimit:null,remainingQuota:null};
      if(userId&&input.providerId){const rows=await tx.policies(userId,input.providerId);
        if(rows.length>1)throw new ConflictException('QUOTA_POLICY_AMBIGUOUS');
        if(rows.length){const totals=await tx.totals(userId,input.providerId,now);
          quota={policyStatus:'ACTIVE',mode:policyMode(rows[0]),quotaLimit:this.limits(rows[0]),remainingQuota:this.remaining(rows[0],totals),
            quotaUnboundedRequests:totals.unboundedRequests,admissionBlockedByUnboundedRequests:rows[0].tokensPerMonth!==null&&rows[0].tokensPerMonth!=='0'&&totals.unboundedRequests!=='0'};
        }else quota={policyStatus:'MISSING',mode:null,quotaLimit:null,remainingQuota:null};}
      return {...statistics,...quota,range:{from,to},quotaWindowAt:now};
    });
  }
}
