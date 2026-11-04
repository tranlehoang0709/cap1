import { Inject, Injectable } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
@Injectable()
export class InternalApiRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool:Pool){}
  async createSession(d:Record<string,unknown>){const[r]=await this.pool.query<ResultSetHeader>('INSERT INTO ai_sessions(conversation_id,device_id,ai_server_instance_id,status,started_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)',[d.conversation_id,d.device_id??null,d.ai_server_instance_id??null,d.status??'active']);return this.session(String(r.insertId));}
  async session(id:string){const[r]=await this.pool.query<RowDataPacket[]>('SELECT id,conversation_id,device_id,ai_server_instance_id,status,started_at,ended_at,error_code FROM ai_sessions WHERE id=?',[id]);return r[0]??null;}
  async updateSession(id:string,d:Record<string,unknown>){await this.pool.query('UPDATE ai_sessions SET status=?,error_code=?,ended_at=IF(? IN (\'completed\',\'failed\',\'closed\'),CURRENT_TIMESTAMP,ended_at) WHERE id=?',[d.status,d.error_code??null,d.status,id]);return this.session(id);}
  async usage(d:Record<string,unknown>){const[r]=await this.pool.query<ResultSetHeader>('INSERT INTO usage_records(user_id,conversation_id,ai_session_id,provider_id,model_id,credential_id,request_kind,input_tokens,output_tokens,duration_ms,status,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))',[d.user_id,d.conversation_id??null,d.ai_session_id??null,d.provider_id,d.model_id??null,d.credential_id??null,d.request_kind,d.input_tokens??null,d.output_tokens??null,d.duration_ms??null,d.status??'success',d.occurred_at??null]);return{id:String(r.insertId)};}
}
