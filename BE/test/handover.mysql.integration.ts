/** Real MySQL + full AppModule. Only a newly initialized local disposable server
 * with the exact dedicated datadir is allowed. Never reads the application's DB. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication,ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createConnection,Connection } from 'mysql2/promise';
import { randomBytes,createHash } from 'node:crypto';
import { readFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import * as bcrypt from 'bcrypt';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

describe('Robot handover against disposable MySQL and full global guards',()=>{
  let db:Connection,app:INestApplication,base:string,admin:string,a:string,b:string,c:string;
  let aId:string,bId:string,device:any,oldConversation:string,legacyConversation:string,historyId:string,credential:string;
  const saved:Record<string,string|undefined>={};
  const service='s'.repeat(43),configToken='c'.repeat(43),key='handover-test-signature-key-at-least-32-bytes';
  const root=resolve(__dirname,'..','node_modules','.cache','aiva-handover-mysql');
  async function rows(sql:string,values:any[]=[]):Promise<any[]>{const [r]=await db.execute(sql,values);return r as any[];}
  async function insert(sql:string,values:any[]=[]){await rows(sql,values);return (await rows('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;}
  async function call(path:string,method='GET',token=admin,body?:unknown,extra:Record<string,string>={}){
    const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  beforeAll(async()=>{
    if(process.env.AIVA_HANDOVER_DISPOSABLE_MYSQL!=='true')throw new Error('Dedicated disposable MySQL opt-in required');
    db=await createConnection({host:'127.0.0.1',port:33317,user:'root',password:'',supportBigNumbers:true,bigNumberStrings:true,timezone:'Z'});
    const directory=(await rows('SELECT @@datadir AS path'))[0].path;
    if(resolve(directory).toLowerCase()!==root.toLowerCase())throw new Error('Refusing non-disposable MySQL datadir');
    const database=`aiva_iot_test_handover_${randomBytes(5).toString('hex')}`;
    await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.changeUser({database});
    // Install the previous baseline into this NEW disposable database only.
    const baseline=(await readFile(resolve(__dirname,'../src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql'),'utf8'))
      .replace(/^.*CREATE DATABASE[^\n]*$/gm,'').replace(/^\s*USE[^\n]*$/gm,'')
      .replace(/^.*`assignment_history_id` BIGINT NULL,\r?\n/gm,'')
      .replace(/^ALTER TABLE `conversations` ADD CONSTRAINT `fk_conversations_assignment_history_id`[^\n]*$/gm,'')
      .replace(/^\s*--[^\n]*$/gm,'');
    for(const statement of baseline.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
    const password=await bcrypt.hash('handover-test-password',4);
    async function user(email:string){const id=await insert(`INSERT INTO users(email,password_hash,display_name,status,email_verified_at,created_at,updated_at)
      VALUES(?,?,'Test User','active',UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,[email,password]);
      await rows("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code='USER'",[id]);return id;}
    aId=await user('handover-a@example.invalid');bId=await user('handover-b@example.invalid');await user('handover-c@example.invalid');
    const legacyDevice=await insert("INSERT INTO devices(device_uid,lifecycle_status,connection_status,created_at,updated_at) VALUES('legacy-robot','available','offline',UTC_TIMESTAMP(),UTC_TIMESTAMP())");
    legacyConversation=await insert("INSERT INTO conversations(user_id,device_id,channel,status,started_at) VALUES(?,?,'robot','completed',UTC_TIMESTAMP())",[aId,legacyDevice]);
    const {migrateRobotHandover}=require('../src/database/migrations/20261105_robot_handover.cjs');
    expect(await migrateRobotHandover(db)).toHaveLength(2);await migrateRobotHandover(db,{apply:true});
    expect(await migrateRobotHandover(db,{apply:true})).toEqual([]);
    expect((await rows('SELECT assignment_history_id FROM conversations WHERE id=?',[legacyConversation]))[0].assignment_history_id).toBeNull();
    const backupDirectory=resolve(root,'backups');await mkdir(backupDirectory,{recursive:true});
    const env:Record<string,string>={NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true',DB_HOST:'127.0.0.1',DB_PORT:'33317',DB_USER:'root',DB_PASSWORD:'',DB_NAME:database,
      JWT_ACCESS_SECRET:key,JWT_REFRESH_SECRET:'r'.repeat(43),APP_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64url'),
      ADMIN_EMAIL:'handover-admin@example.invalid',ADMIN_PASSWORD:'handover-test-password',ADMIN_DISPLAY_NAME:'Test Admin',
      ADMIN_ACCESS_JWT_SECRET:key,ADMIN_ACCESS_JWT_ISSUER:'aiva-iot',ADMIN_ACCESS_JWT_AUDIENCE:'aiva-api',
      HEARTBEAT_SWEEPER_ENABLED:'false',AI_USAGE_REPORT_SWEEPER_ENABLED:'false',
      DEVICE_RESET_SERVICE_TOKEN:service,RESET_CONTRACT_APPROVED:'true',DEVICE_RESET_RETRY_SECONDS:'1',
      AI_DEVICE_SERVICE_TOKEN:'d'.repeat(43),DEVICE_AUTH_CONTRACT_APPROVED:'true',
      AI_CONFIG_SERVICE_TOKEN:configToken,AI_CONFIG_CONTRACT_APPROVED:'true',AI_QUOTA_CONTRACT_APPROVED:'false',
      RECOVERY_STORAGE_APPROVED:'true',RECOVERY_BACKUP_DIRECTORY:backupDirectory,AI_SECRET_KEY_BASE64:Buffer.alloc(32,4).toString('base64'),AI_SECRET_KEY_ID:'handover-test'};
    for(const [name,value]of Object.entries(env)){saved[name]=process.env[name];process.env[name]=value;}
    const {AppModule}=await import('../src/app.module');
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideGuard(ThrottlerGuard).useValue({canActivate:()=>true}).compile();
    app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    for(const [email,set]of [['handover-admin@example.invalid',(t:string)=>admin=t],['handover-a@example.invalid',(t:string)=>a=t],
      ['handover-b@example.invalid',(t:string)=>b=t],['handover-c@example.invalid',(t:string)=>c=t]] as const){
      const login=await call('/auth/login','POST','',{email,password:'handover-test-password'});expect(login.status).toBe(200);set(login.body.access_token);
    }
  });
  afterAll(async()=>{
    if(app)await app.close();if(db)await db.end();
    for(const [name,value]of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    // No DROP/DELETE cleanup. Data belongs only to the disposable server datadir.
  });
  it('registers atomically with code/hash and rotates the unused code',async()=>{
    const registered=await call('/devices/admin','POST',admin,{device_uid:'handover-robot',display_name:'Robot'});
    expect(registered.status).toBe(201);device=registered.body;expect(device.pairing_code).toHaveLength(32);
    const code=(await rows('SELECT * FROM device_pairing_codes WHERE device_id=?',[device.id]))[0];
    expect(code.code_hash).toBe(createHash('sha256').update(device.pairing_code).digest('hex'));expect(JSON.stringify(code)).not.toContain(device.pairing_code);
    expect((await call(`/devices/admin/${device.id}/credential`,'POST',admin,{})).status).toBe(403);
    const rotated=await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{});expect(rotated.status).toBe(201);
    expect((await rows('SELECT revoked_at FROM device_pairing_codes WHERE id=?',[code.id]))[0].revoked_at).not.toBeNull();
    expect((await call('/devices/pairing-requests','POST',a,{pairing_code:device.pairing_code})).status).toBe(400);
    device.pairing_code=rotated.body.pairing_code;
  });
  it('denies profile read/write through both groups before approval and direct unlink',async()=>{
    for(const path of ['/ai/profile','/user/ai/profile']){
      expect((await call(path,'GET',a)).status).toBe(403);
      expect((await call(path,'PATCH',a,path==='/ai/profile'?{assistant_name:'AIVA'}:{assistantName:'AIVA'})).status).toBe(403);
    }
    expect((await call(`/devices/${device.id}/assignment`,'DELETE',a)).status).toBe(403);
  });
  it('two users on different API groups race on the same code: only one pending',async()=>{
    const results=await Promise.all([call('/devices/pairing-requests','POST',a,{pairing_code:device.pairing_code}),
      call('/user/devices/pairing-requests','POST',b,{pairingCode:device.pairing_code})]);
    expect(results.map(r=>r.status).sort()).toEqual([201,400]);
    const pending=await rows("SELECT * FROM device_pairing_requests WHERE device_id=? AND status='pending'",[device.id]);expect(pending).toHaveLength(1);
    expect((await rows('SELECT consumed_at FROM device_pairing_codes WHERE device_id=? AND revoked_at IS NULL',[device.id]))[0].consumed_at).not.toBeNull();
    expect(await rows('SELECT * FROM device_assignments WHERE device_id=?',[device.id])).toHaveLength(0);
    expect((await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{})).status).toBe(409);
    const reviewed=await call(`/admin/pairing-requests/${pending[0].id}/approve`,'POST',admin,{});expect(reviewed.status).toBe(200);
    // Normalize fixture owner for the remaining tests, regardless of race winner.
    if(String(pending[0].user_id)===bId){[a,b]=[b,a];[aId,bId]=[bId,aId];}
    expect((await call('/user/devices/pairing-requests','GET',a)).status).toBe(200);
    expect((await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{})).status).toBe(409);
    expect((await call(`/devices/${device.id}/assignment`,'DELETE',a)).status).toBe(403);
    expect(await rows('SELECT * FROM device_assignments WHERE device_id=?',[device.id])).toHaveLength(1);
  });
  it('allows approved profile and issues credential; turn start records the exact assignment',async()=>{
    expect((await call('/ai/profile','PATCH',a,{assistant_name:'My robot'})).status).toBe(200);
    expect((await call('/user/ai/profile','GET',a)).status).toBe(200);
    expect((await call('/user/ai/profile','PATCH',a,{assistantName:'My approved robot'})).status).toBe(200);
    const issued=await call(`/devices/admin/${device.id}/credential`,'POST',admin,{});expect(issued.status).toBe(201);credential=issued.body.credential;
    const turn=await call('/internal/ai/turns/start','POST',configToken,{userId:aId,deviceId:device.id,channel:'robot'});expect(turn.status).toBe(200);
    oldConversation=turn.body.conversationId;
    historyId=String((await rows('SELECT assignment_history_id FROM conversations WHERE id=?',[oldConversation]))[0].assignment_history_id);
    expect(historyId).not.toBe('null');
    expect((await call(`/conversations/${oldConversation}`,'GET',a)).status).toBe(200);
    expect((await call(`/conversations/${oldConversation}`,'GET',b)).status).toBe(404);
    expect((await call(`/conversations/${legacyConversation}`,'GET',a)).status).toBe(404);
  });
  it('revoke hides old history, revokes AI/device sessions and blocks code/credential until service ACK',async()=>{
    const revoke=await call(`/admin/devices/${device.id}/revoke`,'POST',admin,{}, {'idempotency-key':'handover_revoke_0001'});expect(revoke.status).toBe(202);
    expect((await call(`/conversations/${oldConversation}`,'GET',a)).status).toBe(404);
    expect((await call(`/conversations/${oldConversation}`,'DELETE',a)).status).toBe(404);
    const list=await call('/conversations','GET',a);expect(list.body.items).toEqual([]);
    expect((await rows('SELECT status FROM ai_sessions WHERE conversation_id=?',[oldConversation]))[0].status).toBe('revoked');
    expect((await call('/devices/device/me','GET',credential)).status).toBe(401);
    for(const suffix of ['pairing-codes','credential'])expect((await call(`/devices/admin/${device.id}/${suffix}`,'POST',admin,{})).status).toBeGreaterThanOrEqual(400);
    for(const path of ['/ai/profile','/user/ai/profile'])expect((await call(path,'GET',a)).status).toBe(403);
    expect((await call('/internal/device-reset-jobs/claim','POST','x'.repeat(43),{deviceId:device.id})).status).toBe(401);
    app.get(ConfigService).set('RESET_CONTRACT_APPROVED','false');
    expect((await call('/internal/device-reset-jobs/claim','POST',service,{deviceId:device.id})).status).toBe(403);
    app.get(ConfigService).set('RESET_CONTRACT_APPROVED','true');
    const claim=await call('/internal/device-reset-jobs/claim','POST',service,{deviceId:device.id});expect(claim.status).toBe(200);
    expect(claim.body.claimed).toBe(true);
    const ack={deviceId:device.id,attempt:claim.body.attempt,challenge:claim.body.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true};
    expect((await call(`/internal/device-reset-jobs/${claim.body.jobId}/ack`,'POST','x'.repeat(43),ack)).status).toBe(401);
    expect((await call(`/internal/device-reset-jobs/${claim.body.jobId}/ack`,'POST',service,{...ack,sessionsInvalidated:false})).status).toBe(400);
    expect((await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{})).status).toBe(409);
    expect((await call(`/internal/device-reset-jobs/${claim.body.jobId}/ack`,'POST',service,ack)).status).toBe(200);
    expect((await call(`/devices/admin/${device.id}/credential`,'POST',admin,{})).status).toBe(403);
  });
  it('reject keeps device unowned; new code can pair using current API and legacy review',async()=>{
    let issued=await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{});expect(issued.status).toBe(201);
    const rejected=await call('/user/devices/pairing-requests','POST',b,{pairingCode:issued.body.pairing_code});expect(rejected.status).toBe(201);
    expect((await call(`/devices/admin/pairing-requests/${rejected.body.id}/reject`,'POST',admin,{note:'Not approved'})).status).toBe(201);
    expect(await rows('SELECT * FROM device_assignments WHERE device_id=?',[device.id])).toHaveLength(0);
    issued=await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{});expect(issued.status).toBe(201);
    const submitted=await call('/user/devices/pairing-requests','POST',b,{pairingCode:issued.body.pairing_code});expect(submitted.status).toBe(201);
    expect((await call(`/devices/admin/pairing-requests/${submitted.body.id}/approve`,'POST',admin,{})).status).toBe(201);
    const turn=await call('/internal/ai/turns/start','POST',configToken,{userId:bId,deviceId:device.id,channel:'robot'});expect(turn.status).toBe(200);
    expect((await call(`/conversations/${turn.body.conversationId}`,'GET',b)).status).toBe(200);
    expect((await call(`/conversations/${oldConversation}`,'GET',b)).status).toBe(404);
    expect((await call(`/conversations/${oldConversation}`,'GET',a)).status).toBe(404);
    expect(String((await rows('SELECT assignment_history_id FROM conversations WHERE id=?',[turn.body.conversationId]))[0].assignment_history_id)).not.toBe(historyId);
  });
  it('reassigning the same robot back to its old user never reopens that user’s old history',async()=>{
    expect((await call(`/admin/devices/${device.id}/revoke`,'POST',admin,{}, {'idempotency-key':'handover_revoke_0002'})).status).toBe(202);
    const claim=await call('/internal/device-reset-jobs/claim','POST',service,{deviceId:device.id});expect(claim.status).toBe(200);
    expect((await call(`/internal/device-reset-jobs/${claim.body.jobId}/ack`,'POST',service,{deviceId:device.id,attempt:claim.body.attempt,
      challenge:claim.body.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true})).status).toBe(200);
    const code=await call(`/devices/admin/${device.id}/pairing-codes`,'POST',admin,{});expect(code.status).toBe(201);
    const pending=await call('/devices/pairing-requests','POST',a,{pairing_code:code.body.pairing_code});expect(pending.status).toBe(201);
    expect((await call(`/admin/pairing-requests/${pending.body.id}/approve`,'POST',admin,{})).status).toBe(200);
    expect((await call(`/conversations/${oldConversation}`,'GET',a)).status).toBe(404);
    const turn=await call('/internal/ai/turns/start','POST',configToken,{userId:aId,deviceId:device.id,channel:'robot'});expect(turn.status).toBe(200);
    expect((await call(`/conversations/${turn.body.conversationId}`,'GET',a)).status).toBe(200);
    const list=await call('/conversations','GET',a);expect(list.body.items.map((r:any)=>r.id)).toEqual([turn.body.conversationId]);
    expect((await rows('SELECT id FROM conversations WHERE id=?',[oldConversation]))).toHaveLength(1);
  });
});
