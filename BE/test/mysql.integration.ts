/** Opt-in real MySQL + full Nest HTTP tests. Requires preprovisioned isolated V1.5 DB.
 * External AI Server/Firmware calls are simulated clients: this is NOT hardware E2E.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createPool,Pool } from 'mysql2/promise';
import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { AddressInfo } from 'node:net';
import { validateEnvironment } from '../src/config/configuration';

describe('Opt-in isolated MySQL cross-module API integration',()=>{
  let pool:Pool;let app:Awaited<ReturnType<typeof NestFactory.create>>;let base:string;let directory:string;
  let adminId:string;let userA:string;let userB:string;let ownerId:string;let otherId:string;
  let modelId:string;let localId:string;let cloudId:string;let device:{id:string;uid:string;code:string;credential:string};
  const userIds:string[]=[];const deviceIds:string[]=[];const modelIds:string[]=[];
  const signingKey=randomBytes(32).toString('base64url');const deviceService=randomBytes(32).toString('base64url');
  const configService=randomBytes(32).toString('base64url');const resetService=randomBytes(32).toString('base64url');
  const original:Record<string,string|undefined>={};const prefix=`sprint2_${randomUUID().replace(/-/g,'')}`;
  async function rows(sql:string,values:unknown[]=[]):Promise<any[]>{const [result]=await pool.execute(sql,values as never[]);return result as any[];}
  async function insert(sql:string,values:unknown[]):Promise<string>{const c=await pool.getConnection();try{
    await c.execute(sql,values as never[]);const [result]=await c.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');return (result as any[])[0].id;
  }finally{c.release();}}
  function token(id:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,iss:'sprint2-test',aud:'sprint2-test'})).toString('base64url');
    return `${h}.${p}.${createHmac('sha256',signingKey).update(`${h}.${p}`).digest('base64url')}`;}
  async function api(path:string,method:string,bearer:string,body?:unknown,idempotencyKey?:string){return fetch(base+path,{method,
    headers:{authorization:`Bearer ${bearer}`,...(body===undefined?{}:{'content-type':'application/json'}),
      ...(idempotencyKey?{'idempotency-key':idempotencyKey}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
  async function newCode(id:string){const code=`Pair_${randomBytes(16).toString('hex')}`;
    await insert(`INSERT INTO device_pairing_codes(device_id,code_hash,expires_at,created_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),UTC_TIMESTAMP())`,
      [id,createHash('sha256').update(code).digest('hex')]);return code;}
  async function newDevice(){const uid=`${prefix}_${randomBytes(4).toString('hex')}`;
    const id=await insert(`INSERT INTO devices(device_uid,display_name,hardware_model,lifecycle_status,connection_status,created_at,updated_at)
      VALUES(?,?,'synthetic','available','offline',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,[uid,'Synthetic test device']);deviceIds.push(id);
    const credential=randomBytes(32).toString('base64url');
    await insert(`INSERT INTO device_credentials(device_id,credential_hash,status,created_at) VALUES(?,?,'active',UTC_TIMESTAMP())`,[id,createHash('sha256').update(credential).digest('hex')]);
    return {id,uid,credential,code:await newCode(id)};
  }
  async function revokeAndAck(id:string){
    const revoke=await api(`/admin/devices/${id}/revoke`,'POST',token(adminId),{},randomUUID());expect(revoke.status).toBe(202);
    const recovery=await api(`/admin/devices/${id}/recovery`,'GET',token(adminId));const backupId=(await recovery.json()).backups[0].backupId as string;
    const claimResponse=await api('/internal/device-reset-jobs/claim','POST',resetService,{deviceId:id});expect(claimResponse.status).toBe(200);
    const claim=await claimResponse.json();expect(claim.claimed).toBe(true);
    const ack=await api(`/internal/device-reset-jobs/${claim.jobId}/ack`,'POST',resetService,{deviceId:id,attempt:claim.attempt,challenge:claim.challenge,
      result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true});expect(ack.status).toBe(200);return backupId;
  }
  beforeAll(async()=>{
    if(process.env.MYSQL_INTEGRATION_TESTS!=='true'||!/^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME??''))throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
    validateEnvironment({...process.env,NODE_ENV:'test'});
    directory=await mkdtemp(join(tmpdir(),'aiva-mysql-integration-'));
    const environment:Record<string,string>={NODE_ENV:'test',HEARTBEAT_SWEEPER_ENABLED:'false',AI_QUOTA_CONTRACT_APPROVED:'false',AI_USAGE_REPORT_SWEEPER_ENABLED:'false',ADMIN_ACCESS_JWT_SECRET:signingKey,
      ADMIN_ACCESS_JWT_ISSUER:'sprint2-test',ADMIN_ACCESS_JWT_AUDIENCE:'sprint2-test',DEVICE_AUTH_CONTRACT_APPROVED:'true',AI_DEVICE_SERVICE_TOKEN:deviceService,
      AI_CONFIG_CONTRACT_APPROVED:'true',AI_CONFIG_SERVICE_TOKEN:configService,RESET_CONTRACT_APPROVED:'true',DEVICE_RESET_SERVICE_TOKEN:resetService,
      DEVICE_RESET_RETRY_SECONDS:'60',RECOVERY_STORAGE_APPROVED:'true',RECOVERY_BACKUP_DIRECTORY:directory,
      AI_SECRET_KEY_BASE64:randomBytes(32).toString('base64'),AI_SECRET_KEY_ID:'sprint2-test',AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS:''};
    for(const [name,value]of Object.entries(environment)){original[name]=process.env[name];process.env[name]=value;}
    pool=createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectionLimit:10});
    const roles=await rows("SELECT CAST(id AS CHAR) AS id,code FROM roles WHERE code IN ('ADMIN','USER')");
    const providers=await rows("SELECT CAST(id AS CHAR) AS id,code FROM ai_providers WHERE code IN ('LOCAL','OPENAI') AND is_enabled=1");
    if(roles.length!==2||providers.length!==2)throw new Error('TEST_CATALOG_REQUIRED');
    for(const [index,role]of ['ADMIN','USER','USER'].entries()){
      const id=await insert(`INSERT INTO users(email,password_hash,display_name,status,email_verified_at,created_at,updated_at)
        VALUES(?,'synthetic-not-a-login-hash',?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,[`${prefix}_${index}@example.test`,`${prefix}_${index}`]);
      userIds.push(id);await rows('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)',[id,roles.find(r=>r.code===role).id]);
    }
    [adminId,userA,userB]=userIds;localId=providers.find(p=>p.code==='LOCAL').id;cloudId=providers.find(p=>p.code==='OPENAI').id;
    modelId=await insert("INSERT INTO ai_models(provider_id,model_code,capability,is_enabled) VALUES(?,?,'llm',1)",[localId,prefix]);modelIds.push(modelId);
    device=await newDevice();const {AppModule}=await import('../src/app.module');app=await NestFactory.create(AppModule,{logger:false});
    await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async()=>{
    try{
      if(app)await app.close();
      if(pool){
        const remove=async(table:string,column:string,ids:string[])=>{if(ids.length)await rows(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(()=>'?').join(',')})`,ids);};
        const selectIds=async(table:string,column:string,ids:string[])=>ids.length?(await rows(`SELECT CAST(id AS CHAR) AS id FROM ${table} WHERE ${column} IN (${ids.map(()=>'?').join(',')})`,ids)).map(r=>r.id):[];
        const operations=await selectIds('device_unlink_operations','device_id',deviceIds);const jobs=await selectIds('device_reset_jobs','device_id',deviceIds);
        const conversations=await selectIds('conversations','user_id',userIds);
        if(userIds.length)await rows(`DELETE FROM audit_logs WHERE actor_user_id IN (${userIds.map(()=>'?').join(',')})`,userIds);
        if(deviceIds.length)await rows(`DELETE FROM audit_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.deviceId')) IN (${deviceIds.map(()=>'?').join(',')})`,deviceIds);
        if(adminId)await rows("DELETE FROM system_settings WHERE setting_key LIKE CONCAT(?,'%')",[`recovery.revoke.${adminId}.`]);
        for(const id of userIds)await rows('DELETE FROM system_settings WHERE setting_key=?',[`ai.user.${id}.credentialScope`]);
        for(const id of jobs)await rows('DELETE FROM system_settings WHERE setting_key=?',[`recovery.reset.${id}.challenge`]);
        await remove('usage_records','user_id',userIds);await remove('quota_policies','user_id',userIds);
        await remove('messages','conversation_id',conversations);await remove('ai_sessions','conversation_id',conversations);await remove('conversations','id',conversations);
        await remove('device_reset_jobs','device_id',deviceIds);await remove('device_recovery_backups','unlink_operation_id',operations);
        await remove('device_unlink_operations','device_id',deviceIds);await remove('device_assignment_history','device_id',deviceIds);
        await remove('device_assignments','device_id',deviceIds);await remove('device_pairing_requests','device_id',deviceIds);
        for(const table of ['device_pairing_codes','device_credentials','device_telemetry'])await remove(table,'device_id',deviceIds);
        await remove('devices','id',deviceIds);await remove('ai_profiles','user_id',userIds);await remove('api_credentials','owner_user_id',userIds);
        await remove('auth_sessions','user_id',userIds);await remove('user_roles','user_id',userIds);await remove('users','id',userIds);await remove('ai_models','id',modelIds);
      }
    }finally{
      if(pool)await pool.end();
      if(directory){const target=resolve(directory);if(!target.startsWith(resolve(tmpdir())+sep)||!target.split(sep).at(-1)?.startsWith('aiva-mysql-integration-'))throw new Error('UNSAFE_TEMP_CLEANUP');await rm(target,{recursive:true,force:true});}
      for(const name of Object.keys(original)){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}
    }
  });
  it('Pair -> concurrent Approve -> exactly one assignment -> device authorization and User isolation',async()=>{
    const requests=[];for(const userId of [userA,userB]){const response=await api('/user/devices/pairing-requests','POST',token(userId),{pairingCode:device.code});expect(response.status).toBe(201);requests.push(await response.json());}
    const reviews=await Promise.all(requests.map(r=>api(`/admin/pairing-requests/${r.id}/approve`,'POST',token(adminId),{})));
    expect(reviews.map(r=>r.status).sort()).toEqual([200,409]);
    const assignments=await rows('SELECT CAST(user_id AS CHAR) AS userId FROM device_assignments WHERE device_id=?',[device.id]);expect(assignments).toHaveLength(1);
    ownerId=assignments[0].userId;otherId=ownerId===userA?userB:userA;
    expect((await api(`/user/devices/${device.id}`,'GET',token(otherId))).status).toBe(404);
    expect((await api(`/user/devices/${device.id}`,'PATCH',token(otherId),{displayName:'stolen'})).status).toBe(404);
    expect((await api('/user/devices/pairing-requests','GET',token(ownerId))).status).toBe(200);
    const auth=await api('/internal/devices/authorize','POST',deviceService,{deviceUid:device.uid,credential:device.credential});
    expect(auth.status).toBe(200);expect(await auth.json()).toMatchObject({allowed:true,deviceId:device.id,ownerUserId:ownerId});
  });
  it('User AI profile -> LOCAL config; Cloud metadata/encryption remains isolated',async()=>{
    expect((await api('/user/ai/profile','PATCH',token(ownerId),{assistantName:'Synthetic persona',preferredProviderId:localId,preferredLlmModelId:modelId})).status).toBe(200);
    const config=await api('/internal/ai/resolve-config','POST',configService,{userId:ownerId,deviceId:device.id});expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({userId:ownerId,provider:{id:localId},credentialScope:'NONE',credentialReference:null});
    const secret=`test-only-${randomBytes(24).toString('base64url')}`;
    const response=await api('/user/ai/credentials','POST',token(ownerId),{providerId:cloudId,label:'synthetic key',secret});expect(response.status).toBe(201);
    const key=await response.json();expect(JSON.stringify(key)).not.toContain(secret);
    const stored=await rows('SELECT secret_ciphertext AS ciphertext FROM api_credentials WHERE id=? AND owner_user_id=?',[key.id,ownerId]);expect(stored[0].ciphertext).not.toContain(secret);
    expect((await api(`/user/ai/credentials/${key.id}`,'DELETE',token(otherId))).status).toBe(404);
  });
  it('heartbeat -> offline timeout -> reconnect preserves current assignment',async()=>{
    const timestamp=(await rows('SELECT UTC_TIMESTAMP() AS now'))[0].now as Date;
    const body={deviceUid:device.uid,credential:device.credential,observedAt:timestamp.toISOString(),telemetry:{wifiRssi:-60,freeHeapBytes:'1234',batteryPercent:80}};
    const first=await api('/internal/devices/heartbeat','POST',deviceService,body);expect(first.status).toBe(200);expect(await first.json()).toMatchObject({accepted:true});
    const duplicate=await api('/internal/devices/heartbeat','POST',deviceService,body);expect(await duplicate.json()).toMatchObject({accepted:false});
    await rows('UPDATE devices SET last_seen_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE id=?',[device.id]);
    const monitoring=await api(`/user/devices/${device.id}/monitoring`,'GET',token(ownerId));expect(await monitoring.json()).toMatchObject({connectionStatus:'offline'});
    const fresh=(await rows('SELECT UTC_TIMESTAMP() AS now'))[0].now as Date;
    const reconnect=await api('/internal/devices/heartbeat','POST',deviceService,{...body,observedAt:fresh.toISOString()});expect(await reconnect.json()).toMatchObject({accepted:true});
    expect((await rows('SELECT user_id FROM device_assignments WHERE device_id=?',[device.id]))).toHaveLength(1);
  });
  it('revoke -> durable backup -> simulated authenticated reset ACK -> restore; old credential remains revoked',async()=>{
    const backupId=await revokeAndAck(device.id);
    expect((await api('/internal/devices/authorize','POST',deviceService,{deviceUid:device.uid,credential:device.credential})).status).toBe(401);
    const restore=await api(`/admin/device-recovery/${backupId}/restore`,'POST',token(adminId));expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({status:'RESTORED',ownerUserId:ownerId});
    const dashboard=await api('/user/dashboard/access','GET',token(ownerId));expect(await dashboard.json()).toMatchObject({allowed:true});
    expect((await api('/internal/devices/authorize','POST',deviceService,{deviceUid:device.uid,credential:device.credential})).status).toBe(401);
  });
  it('concurrent restore/new pairing cannot overwrite the new owner',async()=>{
    const second=await newDevice();const create=await api('/user/devices/pairing-requests','POST',token(userA),{pairingCode:second.code});
    expect(create.status).toBe(201);const request=await create.json();expect((await api(`/admin/pairing-requests/${request.id}/approve`,'POST',token(adminId),{})).status).toBe(200);
    const backupId=await revokeAndAck(second.id);const code=await newCode(second.id);
    const newRequest=await api('/user/devices/pairing-requests','POST',token(userB),{pairingCode:code});expect(newRequest.status).toBe(201);const pending=await newRequest.json();
    const results=await Promise.all([api(`/admin/pairing-requests/${pending.id}/approve`,'POST',token(adminId),{}),api(`/admin/device-recovery/${backupId}/restore`,'POST',token(adminId))]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const assignments=await rows('SELECT CAST(user_id AS CHAR) AS userId FROM device_assignments WHERE device_id=?',[second.id]);expect(assignments).toEqual([{userId:userB}]);
  });
});
