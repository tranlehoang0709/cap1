import { BadRequestException } from '@nestjs/common';
import { deviceId } from '../devices/dto/device-query.dto';
import { objectInput,text } from '../ai-providers/ai.dto';

export { deviceId as recoveryId };
export function revokeInput(body:unknown,header:unknown){
  const value=objectInput(body===undefined?{}:body,['reason']);
  const reason=value.reason===undefined?null:text(value.reason,500,true);
  if(typeof header!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(header))throw new BadRequestException('Idempotency-Key of 16–128 letters/digits/_/- required');
  return {reason,key:header};
}
export function claimInput(body:unknown){const input=objectInput(body,['deviceId']);return deviceId(input.deviceId);}
export function ackInput(body:unknown){
  const input=objectInput(body,['deviceId','attempt','challenge','result','sessionsInvalidated','firmwareResetConfirmed','failureCode']);
  const id=deviceId(input.deviceId);
  if(typeof input.attempt!=='number'||!Number.isSafeInteger(input.attempt)||input.attempt<1||input.attempt>2147483647
    ||typeof input.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.challenge)
    ||!['success','failed'].includes(input.result as string))throw new BadRequestException('Invalid reset ACK');
  if(input.result==='success'&&(input.sessionsInvalidated!==true||input.firmwareResetConfirmed!==true||input.failureCode!==undefined))throw new BadRequestException('Successful reset requires both confirmations');
  if(input.result==='failed'&&(!['RESET_FAILED','SESSION_INVALIDATION_FAILED','DELIVERY_FAILED'].includes(input.failureCode as string)
    ||(input.sessionsInvalidated!==undefined&&typeof input.sessionsInvalidated!=='boolean')
    ||(input.firmwareResetConfirmed!==undefined&&typeof input.firmwareResetConfirmed!=='boolean')))throw new BadRequestException('Invalid reset failure');
  return {deviceId:id,attempt:input.attempt,challenge:input.challenge,result:input.result as 'success'|'failed',failureCode:input.failureCode as string|undefined};
}
