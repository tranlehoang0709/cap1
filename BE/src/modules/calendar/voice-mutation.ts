import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'mysql2/promise';

export type VoiceMutation = { userId:string; deviceId:string; sessionId:string; operation:'create'|'update'|'delete'; operationId:string; eventId?:string; title?:string; startsAt?:string; endsAt?:string; timezone?:string };
const mysqlDate=(s?:string)=>s?new Date(s).toISOString().slice(0,19).replace('T',' '):null;
export function payloadText(v:VoiceMutation){return JSON.stringify(v,Object.keys(v).sort());}
export function payloadHash(v:VoiceMutation){return createHash('sha256').update(payloadText(v)).digest('hex');}
export function verifyConfirmationProof(proof:string,v:VoiceMutation,secret:string){const expected=Buffer.from(createHmac('sha256',secret).update(payloadText(v)).digest('base64url'));const actual=Buffer.from(proof);if(!/^[A-Za-z0-9_-]{43,128}$/.test(proof)||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new ForbiddenException('Confirmation proof mismatch');}
const receipt=(v:VoiceMutation)=>createHash('sha256').update(`${v.operation}:${v.operationId}`).digest('hex');

export async function executeVoiceMutation(pool:Pool,v:VoiceMutation){
  const c=await pool.getConnection(); const hash=payloadHash(v);
  try {
    await c.beginTransaction();
    await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[v.userId]);
    let id=v.eventId??null;
    if(v.operation==='create'){
      const k=createHash('sha256').update(`${v.userId}:${v.operationId}`).digest();
      const [old]=await c.execute<any[]>('SELECT id,voice_mutation_receipts FROM personal_events WHERE user_id=? AND voice_create_key=? FOR UPDATE',[v.userId,k]);
      if(old[0]){
        if(old[0].voice_mutation_receipts?.[receipt(v)]?.payload_hash!==hash)throw new ConflictException('Voice replay payload mismatch');
        await c.commit(); return{id:String(old[0].id),replay:true};
      }
      const [overlap]=await c.execute<any[]>('SELECT id FROM personal_events WHERE user_id=? AND deleted_at IS NULL AND start_at < ? AND COALESCE(end_at,start_at) > ? LIMIT 1 FOR UPDATE',[v.userId,mysqlDate(v.endsAt),mysqlDate(v.startsAt)]);
      if(overlap[0])throw new ConflictException('Calendar event conflicts with an existing event');
      const [r]=await c.query<any>("INSERT INTO personal_events(user_id,title,start_at,end_at,timezone,voice_create_key,voice_mutation_receipts,created_at,updated_at) VALUES(?,?,?,?,?,?,JSON_OBJECT(?,JSON_OBJECT('user_id',?,'device_id',?,'session_id',?,'operation',?,'payload_hash',?,'status','committed')),UTC_TIMESTAMP(),UTC_TIMESTAMP())",[v.userId,v.title,mysqlDate(v.startsAt),mysqlDate(v.endsAt),v.timezone??'UTC',k,receipt(v),v.userId,v.deviceId,v.sessionId,v.operation,hash]);
      id=String(r.insertId);
    } else {
      if(!id)throw new BadRequestException('eventId required');
      const [rows]=await c.execute<any[]>('SELECT id,deleted_at,voice_mutation_receipts FROM personal_events WHERE id=? AND user_id=? FOR UPDATE',[id,v.userId]);
      if(!rows[0] || (v.operation!=='delete' && rows[0].deleted_at))throw new ConflictException('Event not found or not owned');
      if(rows[0].voice_mutation_receipts?.[receipt(v)]){
        if(rows[0].voice_mutation_receipts[receipt(v)].payload_hash!==hash)throw new ConflictException('Voice replay payload mismatch');
        await c.commit(); return{id,replay:true};
      }
      const path='$."'+receipt(v)+'"';
      if(v.operation==='delete')await c.query("UPDATE personal_events SET deleted_at=UTC_TIMESTAMP(),voice_mutation_receipts=JSON_SET(COALESCE(voice_mutation_receipts,JSON_OBJECT()),?,JSON_OBJECT('user_id',?,'device_id',?,'session_id',?,'operation',?,'payload_hash',?,'status','committed')),updated_at=UTC_TIMESTAMP() WHERE id=? AND user_id=?",[path,v.userId,v.deviceId,v.sessionId,v.operation,hash,id,v.userId]);
      else await c.query("UPDATE personal_events SET title=?,start_at=?,end_at=?,timezone=?,voice_mutation_receipts=JSON_SET(COALESCE(voice_mutation_receipts,JSON_OBJECT()),?,JSON_OBJECT('user_id',?,'device_id',?,'session_id',?,'operation',?,'payload_hash',?,'status','committed')),updated_at=UTC_TIMESTAMP() WHERE id=? AND user_id=?",[v.title,mysqlDate(v.startsAt),mysqlDate(v.endsAt),v.timezone??'UTC',path,v.userId,v.deviceId,v.sessionId,v.operation,hash,id,v.userId]);
    }
    await c.commit(); return{id,replay:false};
  } catch(e){await c.rollback();throw e;} finally{c.release();}
}
