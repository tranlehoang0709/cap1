import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';

export type PendingCalendarOperation = { id:string; userId:string; deviceId:string; sessionId:string; operation:'create'|'update'|'delete'; payload:any; payloadHash:string; expiresAt:number; used:boolean };

@Injectable()
export class CalendarConfirmationService {
  private readonly pending = new Map<string, PendingCalendarOperation>();
  constructor(private readonly secretProvider: ConfigService) {}
  private hash(payload:any){ return createHash('sha256').update(JSON.stringify(payload,Object.keys(payload).sort())).digest('hex'); }
  prepare(input: Omit<PendingCalendarOperation,'id'|'payloadHash'|'expiresAt'|'used'> & {ttlMs?:number}) {
    const payloadHash=this.hash(input.payload); const id=randomUUID();
    this.pending.set(id,{...input,id,payloadHash,expiresAt:Date.now()+(input.ttlMs??300000),used:false});
    return { pending_id:id, payload_hash:payloadHash, expires_at:new Date(Date.now()+(input.ttlMs??300000)).toISOString() };
  }
  confirm(id:string, userId:string, deviceId:string, sessionId:string, payload:any){
    const p=this.pending.get(id); if(!p || p.used || p.expiresAt<Date.now()) throw new ConflictException('Calendar confirmation expired or unavailable');
    if(p.userId!==userId || p.deviceId!==deviceId || p.sessionId!==sessionId || this.hash(payload)!==p.payloadHash) throw new ConflictException('Calendar confirmation binding mismatch');
    p.used=true;
    const body={userId,deviceId,sessionId,operation:p.operation,operationId:payload.idempotency_key,eventId:payload.event_id,title:payload.title,startsAt:payload.starts_at,endsAt:payload.ends_at,timezone:payload.timezone};
    return { confirmation_proof:createHmac('sha256',this.secretProvider.get<string>('toolExecution.voiceMutationSecret')??'').update(JSON.stringify(body,Object.keys(body).sort())).digest('base64url'), payload_hash:p.payloadHash };
  }
}
