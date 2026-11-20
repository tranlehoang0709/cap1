import 'reflect-metadata';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool, Pool, RowDataPacket } from 'mysql2/promise';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AiService } from '../src/modules/ai/ai.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { Pa08ChatRepository } from '../src/modules/ai/pa08-chat.repository';

const suite = process.env.PA_SWEEP_TEST_DATABASE ? describe : describe.skip;
suite('PA08 persistent conversation -> real HTTP AI route -> recording LLM (isolated MySQL)',()=>{
 let pool:Pool,service:AiService,config:ConfigService,child:ChildProcess,origin:string,user:string,other:string;
 const query=async(sql:string,values:any[]=[]) => (await pool.query<any>(sql,values))[0];
 const token='test-fixture-tool-service-token-not-real-key-43';
 const call=(content:string,conversation?:string,id=randomUUID(),owner=user)=>service.chat(owner,content,undefined,conversation,id);
 async function start(){
  child=spawn(resolve(__dirname,'../../AI_SERVER/.venv/Scripts/python.exe'),[resolve(__dirname,'../../AI_SERVER/tests/pa08_http_fixture.py')],{
   cwd:resolve(__dirname,'../../AI_SERVER'),env:{...process.env,PA08_HTTP_FIXTURE:'true',AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN:token},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((ok,no)=>{
   const timer=setTimeout(()=>no(new Error('AI fixture startup timeout')),20000);
   child.once('error',e=>{clearTimeout(timer);no(e)});
   child.once('exit',()=>{clearTimeout(timer);no(new Error('AI fixture exited before readiness'))});
   child.stdout!.on('data',chunk=>{const m=String(chunk).match(/READY:(\d+)/);if(m){origin='http://127.0.0.1:'+m[1];clearTimeout(timer);ok()}});
  });
  config.set('AI_SERVER_LOCAL_URL',origin);
  for(let n=0;n<40;n++){try{if((await fetch(origin+'/_test/requests')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error('AI fixture not listening');
 }
 async function stop(){if(child && child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 beforeAll(async()=>{
  const database=process.env.PA_SWEEP_TEST_DATABASE;
  if(!database||!/^aiva_pa_sweep_test_[a-z0-9_]+$/.test(database)||!process.env.PA_TEST_HOST||!process.env.PA_TEST_USER)throw new Error('Explicit isolated MySQL required');
  pool=createPool({host:process.env.PA_TEST_HOST,port:Number(process.env.PA_TEST_PORT||3306),user:process.env.PA_TEST_USER,password:process.env.PA_TEST_PASSWORD,database,timezone:'Z',connectionLimit:8});
  expect((await query('SELECT DATABASE() AS db'))[0].db).toBe(database);
  for(const label of ['owner','other']){
   const r=await query("INSERT INTO users(email,password_hash,display_name,status,created_at,updated_at) VALUES(?,'fixture','Fixture','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[randomUUID()+'@example.invalid']);
   const id=String(r.insertId);if(label==='owner')user=id;else other=id;
   await query('INSERT INTO privacy_preferences(user_id,save_history,updated_at) VALUES(?,1,UTC_TIMESTAMP())',[id]);
  }
  config=new ConfigService({toolExecution:{serviceToken:token},auth:{accessTokenSecret:'test-pa08-signing-key-not-a-production-secret'}});
  const auth=new AuthService({} as never,{canLogin:async(id:string)=>({allowed:(await query("SELECT id FROM users WHERE id=? AND status='active'",[id])).length===1})} as never,new JwtService(),config);
  service=new AiService({} as never,{} as never,config,auth,new Pa08ChatRepository(pool));
  await start();
 },30000);
 afterAll(async()=>{await stop();if(pool)await pool.end();});
 it('carries three turns to both understanding and generation; creates one stable session',async()=>{
  const a=await call('My name is An');const b=await call('What is my name?',a.conversation_id);const c=await call('Repeat it',a.conversation_id);
  expect([a.content,b.content,c.content]).toEqual(['turn=1','turn=2','turn=3']);
  const state=await(await fetch(origin+'/_test/requests')).json();
  expect(state.requests.slice(-3).map((r:any)=>r.history.length)).toEqual([0,2,4]);
  expect(state.analyses.slice(-3).map((h:any[])=>h.length)).toEqual([0,2,4]);
  expect(state.requests.at(-1).history[0].content).toBe('My name is An');
  expect(new Set(state.requests.slice(-3).map((r:any)=>r.session)).size).toBe(1);
  expect((await query('SELECT id FROM ai_sessions WHERE conversation_id=?',[a.conversation_id]))).toHaveLength(1);
  expect((await query('SELECT id FROM messages WHERE conversation_id=?',[a.conversation_id]))).toHaveLength(6);
 });
 it('rejects missing, foreign-owned, robot and closed conversations before AI execution',async()=>{
  const a=await call('owned');const before=(await(await fetch(origin+'/_test/requests')).json()).requests.length;
  await expect(call('foreign',a.conversation_id,randomUUID(),other)).rejects.toMatchObject({status:404});
  await expect(call('missing','9223372036854775807')).rejects.toMatchObject({status:404});
  await query("UPDATE conversations SET status='ended',ended_at=UTC_TIMESTAMP() WHERE id=?",[a.conversation_id]);
  await expect(call('closed',a.conversation_id)).rejects.toMatchObject({status:409});
  await query("UPDATE conversations SET status='active',channel='ROBOT' WHERE id=?",[a.conversation_id]);
  await expect(call('robot',a.conversation_id)).rejects.toMatchObject({status:404});
  expect((await(await fetch(origin+'/_test/requests')).json()).requests.length).toBe(before);
 });
 it('separates New Chat and different users',async()=>{
  const a=await call('new A'),b=await call('new B'),c=await call('other user',undefined,randomUUID(),other);
  expect(new Set([a.conversation_id,b.conversation_id,c.conversation_id]).size).toBe(3);
  expect([a.content,b.content,c.content]).toEqual(['turn=1','turn=1','turn=1']);
 });
 it('deduplicates retries even after Backend repository recreation; rejects changed payload',async()=>{
  const id=randomUUID(),a=await call('retry',undefined,id);
  const recreated=new Pa08ChatRepository(pool);const run=jest.fn();
  expect(await recreated.turn(user,id,'retry',undefined,run)).toEqual(a);expect(run).not.toHaveBeenCalled();
  await expect(call('changed',undefined,id)).rejects.toMatchObject({status:409});
  expect(await call('retry',undefined,id)).toEqual(a);
  await query("UPDATE users SET status='disabled' WHERE id=?",[user]);
  try { await expect(call('retry',undefined,id)).rejects.toMatchObject({status:403}); }
  finally { await query("UPDATE users SET status='active' WHERE id=?",[user]); }
  expect(await query('SELECT id FROM messages WHERE conversation_id=?',[a.conversation_id])).toHaveLength(2);
  expect(await query('SELECT id FROM ai_sessions WHERE conversation_id=?',[a.conversation_id])).toHaveLength(1);
 });
 it('deduplicates simultaneous first turns and allows separate conversations to proceed',async()=>{
  const id=randomUUID();const outcomes=await Promise.allSettled([call('slow',undefined,id),call('slow',undefined,id)]);
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
  const record=await query('SELECT conversation_id FROM pa08_web_turns WHERE user_id=? AND request_id=?',[user,id]);
  expect(record).toHaveLength(1);
  expect(await query('SELECT id FROM ai_sessions WHERE conversation_id=?',[record[0].conversation_id])).toHaveLength(1);
  const [a,b]=await Promise.all([call('independent A'),call('independent B')]);
  expect(a.conversation_id).not.toBe(b.conversation_id);
 });
 it('fails closed after a Backend crash leaves a pending turn, and after conversation deletion',async()=>{
  const id=randomUUID(),a=await call('crash marker',undefined,id);
  await query("UPDATE pa08_web_turns SET status='pending',response_json=NULL WHERE user_id=? AND request_id=?",[user,id]);
  await expect(call('crash marker',undefined,id)).rejects.toMatchObject({status:409});
  await query('UPDATE conversations SET deleted_at=UTC_TIMESTAMP() WHERE id=?',[a.conversation_id]);
  await expect(call('deleted',a.conversation_id)).rejects.toMatchObject({status:404});
 });
 it('rejects simultaneous turns in one conversation without duplicate sessions/messages',async()=>{
  const a=await call('start concurrent');const id=randomUUID();const first=call('slow',a.conversation_id,id);
  for(let i=0;i<50;i++){const r=await query("SELECT status FROM pa08_web_turns WHERE user_id=? AND request_id=?",[user,id]);if(r.length)break;await new Promise(r=>setTimeout(r,10));}
  await expect(call('second',a.conversation_id)).rejects.toMatchObject({status:409});
  await expect(call('slow',a.conversation_id,id)).rejects.toMatchObject({status:409});
  const done=await first;expect(await call('slow',a.conversation_id,id)).toEqual(done);
  expect(await query('SELECT id FROM messages WHERE conversation_id=?',[a.conversation_id])).toHaveLength(4);
 });
 it('restores bounded history after TTL expiry and an actual AI fixture process restart',async()=>{
  const a=await call('remember this');await fetch(origin+'/_test/expire',{method:'POST'});
  expect((await call('after expiry',a.conversation_id)).content).toBe('turn=2');
  await stop();await start();
  expect((await call('after process restart',a.conversation_id)).content).toBe('turn=3');
  const state=await(await fetch(origin+'/_test/requests')).json();expect(state.requests[0].history).toHaveLength(4);
 });
 it('bounds restored dialogue to 20 messages and 16000 characters',async()=>{
  const a=await call('bound');for(let i=0;i<12;i++)await call('x'.repeat(2000),a.conversation_id);
  const state=await(await fetch(origin+'/_test/requests')).json();const h=state.requests.at(-1).history;
  expect(h.length).toBeLessThanOrEqual(20);expect(h.length%2).toBe(0);expect(h.reduce((n:number,m:any)=>n+m.content.length,0)).toBeLessThanOrEqual(16000);
 });
 it('honors save_history=false; retains only RAM context and never repeats an unknown upstream execution',async()=>{
  await query('UPDATE privacy_preferences SET save_history=0 WHERE user_id=?',[other]);
  const id=randomUUID(),a=await call('private',undefined,id,other);
  expect((await call('private continuation',a.conversation_id,randomUUID(),other)).content).toBe('turn=2');
  expect(await query('SELECT id FROM messages WHERE conversation_id=?',[a.conversation_id])).toHaveLength(0);
  expect((await query('SELECT response_json FROM pa08_web_turns WHERE user_id=? AND request_id=?',[other,id]))[0].response_json).toBeNull();
  await expect(call('private',undefined,id,other)).rejects.toMatchObject({status:409});
  await stop();await start();
  expect((await call('after private restart',a.conversation_id,randomUUID(),other)).content).toBe('turn=1');
  const failed=randomUUID();await expect(call('upstreamfail',undefined,failed)).rejects.toMatchObject({status:503});
  await expect(call('upstreamfail',undefined,failed)).rejects.toMatchObject({status:409});
  expect((await query('SELECT status FROM pa08_web_turns WHERE user_id=? AND request_id=?',[user,failed]))[0].status).toBe('uncertain');
 });
});
