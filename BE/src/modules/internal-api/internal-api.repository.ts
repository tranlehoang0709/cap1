import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { visibleConversation } from '../devices/assignment-access';
import { MYSQL_POOL } from '../../database/database.constants';
@Injectable()
export class InternalApiRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool:Pool){}
  async createSession(d:Record<string,unknown>){
    const c=await this.pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      const [candidate]=await c.execute<RowDataPacket[]>('SELECT device_id FROM conversations WHERE id=?',[d.conversation_id] as never[]);
      if(candidate[0]?.device_id!=null)await c.execute('SELECT id FROM devices WHERE id=? FOR UPDATE',[candidate[0].device_id]);
      const [context]=await c.execute<RowDataPacket[]>(`SELECT c.id FROM conversations c
        WHERE c.id=? AND c.device_id <=> ? AND c.deleted_at IS NULL AND ${visibleConversation} FOR UPDATE`,[d.conversation_id,d.device_id??null] as never[]);
      if(!context.length)throw new ConflictException('INVALID_AI_CONTEXT');
      await c.execute(`INSERT INTO ai_sessions(conversation_id,device_id,ai_server_instance_id,status,started_at)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP)`,[d.conversation_id,d.device_id??null,d.ai_server_instance_id??null,d.status??'active'] as never[]);
      const [ids]=await c.execute<RowDataPacket[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      const [rows]=await c.execute<RowDataPacket[]>('SELECT * FROM ai_sessions WHERE id=?',[ids[0].id]);
      await c.commit();return rows[0];
    }catch(error){await c.rollback();throw error;}finally{c.release();}
  }
  async session(id:string){const[r]=await this.pool.query<RowDataPacket[]>('SELECT id,conversation_id,device_id,ai_server_instance_id,status,started_at,ended_at,error_code FROM ai_sessions WHERE id=?',[id]);return r[0]??null;}
  async updateSession(id:string,d:Record<string,unknown>){
    const [r]=await this.pool.query<ResultSetHeader>(`UPDATE ai_sessions s JOIN conversations c ON c.id=s.conversation_id
      SET s.status=?,s.error_code=?,s.ended_at=IF(? IN ('completed','failed','closed'),CURRENT_TIMESTAMP,s.ended_at)
      WHERE s.id=? AND s.status<>'revoked' AND c.deleted_at IS NULL AND ${visibleConversation}`,
      [d.status,d.error_code??null,d.status,id]);
    if(!r.affectedRows)throw new ConflictException('INVALID_AI_CONTEXT');
    return this.session(id);
  }
  async usage(d:Record<string,unknown>){const[r]=await this.pool.query<ResultSetHeader>('INSERT INTO usage_records(user_id,conversation_id,ai_session_id,provider_id,model_id,credential_id,request_kind,input_tokens,output_tokens,duration_ms,status,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))',[d.user_id,d.conversation_id??null,d.ai_session_id??null,d.provider_id,d.model_id??null,d.credential_id??null,d.request_kind,d.input_tokens??null,d.output_tokens??null,d.duration_ms??null,d.status??'success',d.occurred_at??null]);return{id:String(r.insertId)};}
}
