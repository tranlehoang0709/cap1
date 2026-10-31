import { BadRequestException,ConflictException } from '@nestjs/common';
import { deviceId } from '../../devices/dto/device-query.dto';
import { objectInput } from '../../ai-providers/ai.dto';
import { AdmissionInput,QuotaMode,QuotaPolicy } from '../quotas.types';

export function quotaId(value:unknown):string{return deviceId(value);}
export function requestId(value:unknown):string{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value))throw new BadRequestException('Invalid requestId');return value;
}
export function tokenCount(value:unknown):string{
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)throw new BadRequestException('Token count must be a nonnegative BIGINT decimal string');return value;
}
export function policyMode(p:Pick<QuotaPolicy,'requestsPerMinute'|'requestsPerDay'|'tokensPerMonth'>):QuotaMode{
  const fields=[p.requestsPerMinute,p.requestsPerDay,p.tokensPerMonth];
  if(fields.every(v=>v===null))return 'UNLIMITED';
  if(fields.every(v=>v!==null&&String(v)==='0'))return 'BLOCKED';
  if(fields.some(v=>v!==null&&(typeof v==='number'?(!Number.isInteger(v)||v<=0||v>2147483647):(!/^[1-9]\d{0,18}$/.test(v)||BigInt(v)>9223372036854775807n))))throw new ConflictException('INVALID_QUOTA_POLICY');
  return 'LIMITED';
}
export function policyInput(body:unknown){
  const input=objectInput(body,['mode','requestsPerMinute','requestsPerDay','tokensPerMonth','expectedPolicyId'],true);
  if(!['UNLIMITED','LIMITED','BLOCKED'].includes(input.mode as string)||input.expectedPolicyId===undefined)throw new BadRequestException('mode and expectedPolicyId required');
  const mode=input.mode as QuotaMode;const expectedPolicyId=input.expectedPolicyId===null?null:quotaId(input.expectedPolicyId);
  const limits:{requestsPerMinute:number|null;requestsPerDay:number|null;tokensPerMonth:string|null}={requestsPerMinute:null,requestsPerDay:null,tokensPerMonth:null};
  for(const name of ['requestsPerMinute','requestsPerDay','tokensPerMonth'] as const){
    const value=input[name];
    if(mode!=='LIMITED'){
      const desired=mode==='BLOCKED'?(name==='tokensPerMonth'?'0':0):null;
      if(value!==undefined&&value!==desired)throw new BadRequestException('Limits contradict mode');
      if(name==='tokensPerMonth')limits[name]=desired as string|null;else limits[name]=desired as number|null;
    }else{
      if(value===undefined)throw new BadRequestException('LIMITED requires all limit fields, with explicit null for unbounded dimensions');
      if(value===null)continue;
      if(name==='tokensPerMonth'){limits[name]=tokenCount(value);if(limits[name]==='0')throw new BadRequestException('LIMITED limits must be positive or null');}
      else {if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)throw new BadRequestException('LIMITED request limits must be positive INTs or null');limits[name]=value;}
    }
  }
  if(mode==='LIMITED'&&Object.values(limits).every(v=>v===null))throw new BadRequestException('Use UNLIMITED for all-null limits');
  return {mode,expectedPolicyId,...limits};
}
export function admissionInput(body:unknown):AdmissionInput{
  const input=objectInput(body,['requestId','userId','providerId','modelId','deviceId','sessionId','conversationId','maxTotalTokens']);
  const optionalId=(key:string)=>input[key]===undefined||input[key]===null?null:quotaId(input[key]);
  return {requestId:requestId(input.requestId),userId:quotaId(input.userId),providerId:quotaId(input.providerId),modelId:quotaId(input.modelId),
    deviceId:optionalId('deviceId'),sessionId:optionalId('sessionId'),conversationId:optionalId('conversationId'),
    maxTotalTokens:input.maxTotalTokens===undefined||input.maxTotalTokens===null?null:tokenCount(input.maxTotalTokens)};
}
export function reportInput(body:unknown){
  const input=objectInput(body,['requestId','providerId','status','inputTokens','outputTokens','durationMs']);
  if(typeof input.status!=='string'||!['success','failed','cancelled'].includes(input.status.toLowerCase()))throw new BadRequestException('Invalid usage status');
  function integer(name:string){const value=input[name];if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>2147483647)throw new BadRequestException(`Invalid ${name}`);return value;}
  return {requestId:requestId(input.requestId),providerId:quotaId(input.providerId),status:input.status.toLowerCase(),
    inputTokens:integer('inputTokens'),outputTokens:integer('outputTokens'),durationMs:integer('durationMs')};
}
export function statisticsInput(query:Record<string,unknown>,admin:boolean){
  objectInput(query,admin?['userId','providerId','from','to']:['providerId','from','to']);
  function date(key:string){const value=query[key];if(value===undefined)return null;
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new BadRequestException(`Invalid ${key}; use UTC ISO whole seconds`);return new Date(value);}
  const from=date('from'),to=date('to');if((from&&!to)||(!from&&to)||(from&&to&&from>=to))throw new BadRequestException('Supply both from and exclusive to with from < to');
  return {userId:query.userId===undefined?null:quotaId(query.userId),providerId:query.providerId===undefined?null:quotaId(query.providerId),from,to};
}
