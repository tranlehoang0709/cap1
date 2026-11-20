import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';

export type ChatReply = { content: string; tool: string | null; grounded: boolean; conversation_id: string };
export type ChatContext = { conversationId: string; sessionId: string; history?: {role: string; content: string}[] };

/** Persistent identity and idempotency; network calls never hold a SQL transaction.
 * Advisory locks span the call and work across Backend processes. A pending turn
 * after a crash is NOT executed again: its upstream outcome is unknown.
 */
@Injectable()
export class Pa08ChatRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async turn(userId: string, requestId: string, content: string, requestedId: string | undefined,
    run: (context: ChatContext) => Promise<Omit<ChatReply, 'conversation_id'>>): Promise<ChatReply> {
    if (!/^[1-9][0-9]{0,18}$/.test(userId) || (requestedId !== undefined && !/^[1-9][0-9]{0,18}$/.test(requestedId)) ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new BadRequestException('INVALID_AI_CONTEXT');
    const c = await this.pool.getConnection();
    const locks: string[] = [];
    const hash = createHash('sha256').update(JSON.stringify([requestedId ?? null, content])).digest('hex');
    let pending = false;
    const lock = async (name: string) => {
      const [r] = await c.execute<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS ok', [name]);
      if (Number(r[0].ok) !== 1) throw new ConflictException('CHAT_IN_PROGRESS');
      locks.push(name);
    };
    const owned = async (id: string) => {
      const [r] = await c.execute<RowDataPacket[]>(`SELECT id FROM conversations
        WHERE id=? AND user_id=? AND device_id IS NULL AND LOWER(channel)='web' AND deleted_at IS NULL FOR UPDATE`, [id,userId]);
      if (!r.length) throw new NotFoundException('CONVERSATION_NOT_FOUND');
      const [state] = await c.execute<RowDataPacket[]>('SELECT status FROM conversations WHERE id=?', [id]);
      if (state[0].status !== 'active') throw new ConflictException('CONVERSATION_CLOSED');
    };
    try {
      await lock('pa08_req_' + createHash('sha256').update(userId + ':' + requestId).digest('hex').slice(0,55));
      await c.beginTransaction();
      // Replays must not bypass the active-account check performed for new delegations.
      const [actor] = await c.execute<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE",[userId]);
      if(!actor.length) throw new ForbiddenException('USER_ACCESS_DENIED');
      const [prior] = await c.execute<RowDataPacket[]>('SELECT * FROM pa08_web_turns WHERE user_id=? AND request_id=? FOR UPDATE', [userId,requestId]);
      if (prior.length) {
        if (prior[0].content_hash !== hash) throw new ConflictException('REQUEST_ID_CONFLICT');
        await owned(String(prior[0].conversation_id));
        if (prior[0].status !== 'complete') throw new ConflictException('CHAT_OUTCOME_UNKNOWN');
        const [privacy] = await c.execute<RowDataPacket[]>('SELECT save_history FROM privacy_preferences WHERE user_id=? FOR UPDATE',[userId]);
        if (privacy[0]?.save_history !== 1 || !prior[0].response_json) throw new ConflictException('CHAT_REPLAY_UNAVAILABLE');
        const reply = typeof prior[0].response_json === 'string' ? JSON.parse(prior[0].response_json) : prior[0].response_json;
        await c.commit();
        return reply;
      }
      let conversationId = requestedId;
      if (conversationId) {
        await lock('pa08_conv_' + conversationId);
        await owned(conversationId);
      } else {
        const [created] = await c.execute<ResultSetHeader>(`INSERT INTO conversations(user_id,channel,status,started_at)
          VALUES(?,'WEB','active',UTC_TIMESTAMP())`, [userId]);
        conversationId = String(created.insertId);
        await lock('pa08_conv_' + conversationId);
      }
      const [sessions] = await c.execute<RowDataPacket[]>(`SELECT id FROM ai_sessions WHERE conversation_id=?
        AND device_id IS NULL AND status='active' ORDER BY id LIMIT 1 FOR UPDATE`, [conversationId]);
      let sessionId = sessions.length ? String(sessions[0].id) : '';
      if (!sessionId) {
        const [created] = await c.execute<ResultSetHeader>(`INSERT INTO ai_sessions(conversation_id,status,started_at)
          VALUES(?,'active',UTC_TIMESTAMP())`, [conversationId]);
        sessionId = String(created.insertId);
      }
      const [privacy] = await c.execute<RowDataPacket[]>('SELECT save_history FROM privacy_preferences WHERE user_id=? FOR UPDATE',[userId]);
      let history: ChatContext['history'];
      if (privacy[0]?.save_history === 1) {
        const [messages] = await c.execute<RowDataPacket[]>(`SELECT role,content FROM messages WHERE conversation_id=?
          AND role IN ('user','assistant') AND content IS NOT NULL ORDER BY id DESC LIMIT 20`, [conversationId]);
        history = [];
        let chars = 0;
        const chronological = messages.reverse();
        // Keep complete pairs only. History is untrusted dialogue, never system/tool instructions.
        for (let i=chronological.length-2;i>=0;i-=2) {
          const a=chronological[i], b=chronological[i+1];
          if(a.role!=='user'||b.role!=='assistant') break;
          chars += a.content.length + b.content.length;
          if(chars>16000) break;
          history.unshift({role:'user',content:a.content},{role:'assistant',content:b.content});
        }
      }
      await c.execute(`INSERT INTO pa08_web_turns(user_id,request_id,conversation_id,content_hash,status,created_at)
        VALUES(?,?,?,?,'pending',UTC_TIMESTAMP())`, [userId,requestId,conversationId,hash]);
      await c.commit();
      pending = true;
      const result = await run({conversationId, sessionId:'web_' + sessionId, history});
      const reply: ChatReply = {...result,conversation_id:conversationId};
      await c.beginTransaction();
      await owned(conversationId);
      const [currentPrivacy] = await c.execute<RowDataPacket[]>('SELECT save_history FROM privacy_preferences WHERE user_id=? FOR UPDATE',[userId]);
      const save = currentPrivacy[0]?.save_history === 1;
      if(save) await c.execute(`INSERT INTO messages(conversation_id,role,content,created_at)
        VALUES(?,'user',?,UTC_TIMESTAMP()),(?,'assistant',?,UTC_TIMESTAMP())`,[conversationId,content,conversationId,reply.content]);
      await c.execute(`UPDATE pa08_web_turns SET status='complete',response_json=?,completed_at=UTC_TIMESTAMP()
        WHERE user_id=? AND request_id=?`,[save?JSON.stringify(reply):null,userId,requestId]);
      await c.commit();
      pending = false;
      return reply;
    } catch(error) {
      await c.rollback();
      if(pending) await c.execute("UPDATE pa08_web_turns SET status='uncertain' WHERE user_id=? AND request_id=? AND status='pending'",[userId,requestId]);
      throw error;
    } finally {
      try { for(const name of locks.reverse()) await c.execute('SELECT RELEASE_LOCK(?)',[name]); c.release(); }
      catch(error) { c.destroy(); throw error; }
    }
  }
}
