import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { RecoveryService } from '../src/modules/device-recovery/recovery.service';
import { RecoveryStore,BackupContent } from '../src/modules/device-recovery/recovery-store';
import { RecoveryRepository,RecoveryTransaction } from '../src/modules/device-recovery/recovery.repository';
import { SecretEncryptionService } from '../src/modules/api-keys/secret-encryption.service';
import { ackInput,revokeInput } from '../src/modules/device-recovery/recovery.dto';
import { PairingTransaction } from '../src/modules/pairing/pairing.repository';

const admin={userId:'1',role:'ADMIN' as const};const user={userId:'7',role:'USER' as const};
const start=new Date('2026-10-30T01:00:00Z');const sevenDays=7*86400000;
const snapshot:BackupContent={version:1,deviceId:'42',formerUserId:'7',displayName:'Old name',assignment:{userId:'7',pairingRequestId:'9',assignedBy:'1',assignedAt:start.toISOString()}};

describe('RecoveryStore actual encrypted temporary files',()=>{
  let directory:string;let config:ConfigService;let store:RecoveryStore;
  beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'aiva-recovery-test-'));
    config=new ConfigService({RECOVERY_STORAGE_APPROVED:'true',RECOVERY_BACKUP_DIRECTORY:directory,
      AI_SECRET_KEY_BASE64:Buffer.alloc(32,6).toString('base64'),AI_SECRET_KEY_ID:'test'});
    store=new RecoveryStore(config,new SecretEncryptionService(config));});
  afterEach(async()=>{const target=resolve(directory);expect(target.startsWith(resolve(tmpdir())+sep)).toBe(true);
    expect(target.split(sep).at(-1)).toMatch(/^aiva-recovery-test-/);await rm(target,{recursive:true,force:true});});
  it('flushes encrypted bytes, checks integrity/context and deletes without exposing content',async()=>{
    const backup=await store.createRecoveryBackup(snapshot,'10');
    const bytes=await readFile(join(directory,backup.uri.slice('recovery-file:'.length)),'utf8');
    expect(bytes).not.toContain('Old name');expect(bytes).not.toContain('formerUserId');
    expect(backup.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await store.read(backup,'42','10')).toEqual(snapshot);
    await expect(store.read(backup,'43','10')).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
    await store.remove(backup.uri);await store.remove(backup.uri);
    await expect(store.read(backup,'42','10')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects corrupted backup, unapproved root and path traversal',async()=>{
    const backup=await store.createRecoveryBackup(snapshot,'10');
    await writeFile(join(directory,backup.uri.slice('recovery-file:'.length)),'corrupt');
    await expect(store.read(backup,'42','10')).rejects.toThrow('BACKUP_INTEGRITY_FAILED');
    await expect(store.remove('recovery-file:../../outside.enc')).rejects.toThrow('INVALID_BACKUP_REFERENCE');
    config.set('RECOVERY_STORAGE_APPROVED','false');await expect(store.createRecoveryBackup(snapshot,'11')).rejects.toThrow('RECOVERY_STORAGE_NOT_CONFIGURED');
  });
  it('finds only its encrypted orphan files older than seven days with controlled time',async()=>{
    const backup=await store.createRecoveryBackup(snapshot,'10');
    const path=join(directory,backup.uri.slice('recovery-file:'.length));await utimes(path,start,start);
    await writeFile(join(directory,'unrelated.txt'),'leave me');
    expect(await store.orphanCandidates(new Date(start.getTime()+sevenDays-1))).toEqual([]);
    expect(await store.orphanCandidates(new Date(start.getTime()+sevenDays))).toEqual([backup.uri]);
  });
});

describe('RecoveryService transactional state model',()=>{
  let service:RecoveryService;let repository:any;let store:any;let tx:any;let state:any;let config:ConfigService;let files:Map<string,BackupContent>;
  beforeEach(()=>{
    state={now:start,device:{id:'42',lifecycleStatus:'assigned',displayName:'Old name'},assignment:{deviceId:'42',userId:'7',pairingRequestId:'9',assignedBy:'1',assignedAt:start},
      operation:null,backup:null,job:null,settings:{},audits:[],history:[{id:'20',unlinkedAt:null}],credentialsActive:true,codesActive:true,
      pendingRequests:1,otherRobot:{id:'99',owner:'7'},user:{id:'7',status:'active'}};files=new Map();
    config=new ConfigService({RESET_CONTRACT_APPROVED:'true',DEVICE_RESET_RETRY_SECONDS:'30'});
    const clone=(v:any)=>v===null?null:structuredClone(v);
    tx={ownership:{devices:{findDeviceById:jest.fn(async()=>clone(state.device)),users:{
      findByIdForUpdate:jest.fn(async(id:string)=>({id,status:'active',email_verified_at:start})),
      findUserRoles:jest.fn(async(id:string)=>[{code:id==='1'?'ADMIN':'USER'}])}}},
      now:jest.fn(async()=>state.now),assignment:jest.fn(async()=>clone(state.assignment)),assignmentApproved:jest.fn(async()=>true),displayName:jest.fn(async()=>state.device.displayName),
      history:jest.fn(async()=> '20'),createOperation:jest.fn(async()=>{state.operation={id:'10',deviceId:'42',formerUserId:'7',historyId:'20',status:'requested',revokedAt:null,completedAt:null};return '10';}),
      insertBackup:jest.fn(async(op:string,stored:any,now:Date)=>{state.backup={id:'30',operationId:op,deviceId:'42',formerUserId:'7',...stored,createdAt:now,expiresAt:new Date(now.getTime()+sevenDays),deletedAt:null,restoredAt:null};return '30';}),
      revoke:jest.fn(async(_:unknown,_h:string,op:string)=>{state.assignment=null;state.history[0].unlinkedAt=state.now;
        state.credentialsActive=false;state.codesActive=false;state.pendingRequests=0;state.device.lifecycleStatus='reset_pending';
        state.operation.status='reset_pending';state.operation.revokedAt=state.now;
        state.job={id:'40',deviceId:'42',operationId:op,status:'pending',attempt:0,sentAt:null,acknowledgedAt:null,lastError:null};return '40';}),
      latestOperation:jest.fn(async()=>clone(state.operation)),operation:jest.fn(async()=>clone(state.operation)),latestJob:jest.fn(async()=>clone(state.job)),job:jest.fn(async()=>clone(state.job)),
      backup:jest.fn(async()=>clone(state.backup)),backups:jest.fn(async()=>state.backup?[clone(state.backup)]:[]),backupForOperation:jest.fn(async()=>clone(state.backup)),
      setting:jest.fn(async(key:string)=>clone(state.settings[key]??null)),saveSetting:jest.fn(async(key:string,value:any)=>{state.settings[key]=clone(value);}),
      audit:jest.fn(async(...values:any[])=>{state.audits.push(values);}),
      claim:jest.fn(async(job:any,hash:string,now:Date)=>{state.job.status='sent';state.job.sentAt=now;state.job.attempt++;
        state.settings[`recovery.reset.${job.id}.challenge`]={hash,attempt:state.job.attempt};}),
      acknowledge:jest.fn(async(_:unknown,success:boolean,code:string|null,now:Date)=>{state.job.status=success?'acknowledged':'failed';
        state.job.acknowledgedAt=success?now:null;state.job.lastError=code;state.operation.status=success?'completed':'failed';
        state.operation.completedAt=success?now:null;if(success)state.device.lifecycleStatus='available';}),
      restore:jest.fn(async(backup:any,content:BackupContent,_admin:string,now:Date)=>{state.assignment={deviceId:'42',userId:'7',pairingRequestId:content.assignment.pairingRequestId,assignedAt:now};
        state.device.lifecycleStatus='assigned';state.device.displayName=content.displayName;state.history.push({id:'21',unlinkedAt:null});state.backup.restoredAt=now;}),
      markDeleted:jest.fn(async(_:string,now:Date)=>{state.backup.deletedAt=now;})};
    let tail=Promise.resolve();repository={transaction:jest.fn(async(work:any)=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;
      const before=clone(state);try{return await work(tx);}catch(error){state=before;throw error;}finally{release();}}),
      expiredIds:jest.fn(async()=>state.backup&&!state.backup.deletedAt&&state.backup.expiresAt<=state.now?['30']:[]),referenced:jest.fn(async()=>false)};
    store={createRecoveryBackup:jest.fn(async(content:BackupContent)=>{files.set('recovery-file:test.enc',clone(content));return {uri:'recovery-file:test.enc',checksum:'hash',keyRef:'test'};}),
      read:jest.fn(async()=>clone(files.get('recovery-file:test.enc'))),remove:jest.fn(async(uri:string)=>{files.delete(uri);}),orphanCandidates:jest.fn(async()=>[])};
    service=new RecoveryService(repository,store,config);
  });
  const revoke=()=>service.revokeDeviceAssignment(admin,'42',{reason:'Owner requested'},'revoke_request_0001');
  async function completeReset(){await revoke();const claim=await service.requestDeviceReset({deviceId:'42'}) as any;
    await service.processResetAcknowledgment('40',{deviceId:'42',attempt:claim.attempt,challenge:claim.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true});return claim;}
  it('backs up before removing assignment; seven-day expiry and no other User/device changes',async()=>{
    const userBefore=structuredClone(state.user),otherBefore=structuredClone(state.otherRobot);
    const result=await revoke();expect(result).toMatchObject({operationId:'10',deviceId:'42',status:'RESET_PENDING',resetStatus:'PENDING',backupExpiresAt:new Date(start.getTime()+sevenDays)});
    expect(store.createRecoveryBackup.mock.invocationCallOrder[0]).toBeLessThan(tx.revoke.mock.invocationCallOrder[0]);
    expect(state.assignment).toBeNull();expect(state.credentialsActive).toBe(false);expect(state.codesActive).toBe(false);
    expect(state.user).toEqual(userBefore);expect(state.otherRobot).toEqual(otherBefore);expect(state.device.lifecycleStatus).toBe('reset_pending');
    expect(JSON.stringify(result)).not.toMatch(/uri|keyRef|checksum|challenge/);
  });
  it('backup/storage failure prevents revocation and rolls back the operation',async()=>{
    store.createRecoveryBackup.mockRejectedValue(new Error('disk failed'));
    await expect(revoke()).rejects.toMatchObject({status:500});expect(state.assignment.userId).toBe('7');expect(state.operation).toBeNull();expect(tx.revoke).not.toHaveBeenCalled();
  });
  it('audit failure rolls back assignment/credentials/job, while encrypted orphan is retained safely',async()=>{
    tx.audit.mockRejectedValue(new Error('audit failed'));
    await expect(revoke()).rejects.toMatchObject({status:500});expect(state.assignment.userId).toBe('7');expect(state.credentialsActive).toBe(true);expect(state.job).toBeNull();expect(files.size).toBe(1);
  });
  it('duplicate revoke is idempotent, conflicts on key reuse and does not revoke a new owner',async()=>{
    await revoke();await revoke();expect(tx.revoke).toHaveBeenCalledTimes(1);expect(store.createRecoveryBackup).toHaveBeenCalledTimes(1);
    await expect(service.revokeDeviceAssignment(admin,'42',{reason:'different'},'revoke_request_0001')).rejects.toMatchObject({status:409});
    state.assignment={deviceId:'42',userId:'8',pairingRequestId:'11'};await revoke();expect(state.assignment.userId).toBe('8');
  });
  it('concurrent revoke requests produce one operation/backup/reset job in the transaction model',async()=>{
    const results=await Promise.all([revoke(),service.revokeDeviceAssignment(admin,'42',{},'revoke_request_0002')]);
    expect(results.map(r=>r.operationId)).toEqual(['10','10']);expect(tx.revoke).toHaveBeenCalledTimes(1);expect(store.createRecoveryBackup).toHaveBeenCalledTimes(1);
  });
  it('offline device remains reset-pending until confirmed ACK, failed delivery is recoverable',async()=>{
    await revoke();const claim=await service.requestDeviceReset({deviceId:'42'}) as any;
    expect(claim).toMatchObject({claimed:true,jobId:'40',attempt:1,status:'SENT'});expect(state.operation.status).toBe('reset_pending');
    expect(await service.requestDeviceReset({deviceId:'42'})).toMatchObject({claimed:false,status:'SENT'});
    expect(tx.claim).toHaveBeenCalledTimes(1);
    await service.processResetAcknowledgment('40',{deviceId:'42',attempt:1,challenge:claim.challenge,result:'failed',failureCode:'DELIVERY_FAILED'});
    expect(state.operation.status).toBe('failed');expect(state.device.lifecycleStatus).toBe('reset_pending');
    state.now=new Date(start.getTime()+31000);const retry=await service.requestDeviceReset({deviceId:'42'}) as any;
    expect(retry.attempt).toBe(2);expect(retry.challenge).not.toBe(claim.challenge);
    await expect(service.processResetAcknowledgment('40',{deviceId:'42',attempt:1,challenge:claim.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true})).rejects.toMatchObject({status:409});
  });
  it('valid ACK completes reset, duplicate ACK does not change state/audit twice',async()=>{
    const claim=await completeReset();expect(state.device.lifecycleStatus).toBe('available');expect(state.operation.status).toBe('completed');expect(state.job.status).toBe('acknowledged');
    const count=state.audits.length;
    expect(await service.processResetAcknowledgment('40',{deviceId:'42',attempt:1,challenge:claim.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true})).toMatchObject({status:'ACKNOWLEDGED'});
    expect(state.audits).toHaveLength(count);
  });
  it('existing Pairing reset gate blocks pending and allows completed matching reset with fresh code',async()=>{
    await revoke();
    const connection={execute:jest.fn(async(sql:string)=>{
      if(sql.includes("status <> 'completed'"))return [state.operation.status==='completed'?[]:[{id:'10'}]];
      if(sql.includes('FROM device_unlink_operations'))return [[{id:'10',historyId:'20',revokedAt:state.operation.revokedAt}]];
      if(sql.includes('FROM device_assignment_history'))return [[{id:'20',unlinkedAt:state.history[0].unlinkedAt}]];
      if(sql.includes('FROM device_reset_jobs'))return [[{unlinkId:'10',status:state.job.status,acknowledgedAt:state.job.acknowledgedAt}]];
      throw new Error('Unexpected SQL');
    })};
    const pairing=new PairingTransaction({} as never,connection as never);
    expect(await pairing.resetAllowsPairing('42',start)).toBe(false);
    const claim=await service.requestDeviceReset({deviceId:'42'}) as any;
    await service.processResetAcknowledgment('40',{deviceId:'42',attempt:1,challenge:claim.challenge,result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true});
    expect(await pairing.resetAllowsPairing('42',start)).toBe(true);
  });
  it('rejects fake proof and never treats send/offline as success',async()=>{
    await revoke();await service.requestDeviceReset({deviceId:'42'});
    await expect(service.processResetAcknowledgment('40',{deviceId:'42',attempt:1,challenge:'x'.repeat(43),result:'success',sessionsInvalidated:true,firmwareResetConfirmed:true})).rejects.toMatchObject({status:403});
    expect(state.operation.status).toBe('reset_pending');await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409});
  });
  it('restores within 7 days, never unrevokes old credentials or changes User/global config',async()=>{
    await completeReset();const result=await service.restoreDeviceAssignment(admin,'30');
    expect(result).toEqual({deviceId:'42',status:'RESTORED',ownerUserId:'7'});expect(state.assignment.userId).toBe('7');
    expect(state.credentialsActive).toBe(false);expect(state.user).toEqual({id:'7',status:'active'});expect(state.history).toHaveLength(2);
    await service.restoreDeviceAssignment(admin,'30');expect(tx.restore).toHaveBeenCalledTimes(1);
  });
  it('expires exactly at 7 days; never overwrites a new owner or later unlink',async()=>{
    await completeReset();state.now=new Date(start.getTime()+sevenDays);
    await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409,message:'BACKUP_EXPIRED'});
    state.now=start;state.assignment={deviceId:'42',userId:'8'};
    await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409,message:'DEVICE_HAS_OWNER'});
    expect(tx.restore).not.toHaveBeenCalled();
    state.assignment=null;state.operation.id='11';await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409});
  });
  it('rechecks expiry after backup I/O before restoring',async()=>{
    await completeReset();store.read.mockImplementation(async()=>{state.now=new Date(start.getTime()+sevenDays);return snapshot;});
    await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409,message:'BACKUP_EXPIRED'});
    expect(tx.restore).not.toHaveBeenCalled();
  });
  it.each(['restore-first','pairing-first'])('concurrent restore vs pairing %s yields one owner in serialized transaction model',async order=>{
    await completeReset();
    const pair=()=>repository.transaction(async()=>{if(state.assignment)throw new ConflictException('owned');state.assignment={deviceId:'42',userId:'8'};state.device.lifecycleStatus='assigned';});
    const results=await Promise.allSettled(order==='restore-first'?[service.restoreDeviceAssignment(admin,'30'),pair()]:[pair(),service.restoreDeviceAssignment(admin,'30')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(state.assignment.userId).toBe(order==='restore-first'?'7':'8');
  });
  it('cleans expired ciphertext with controlled DB time and keeps metadata/audit',async()=>{
    await revoke();state.now=new Date(start.getTime()+sevenDays-1);
    expect(await service.cleanupExpiredBackups()).toEqual({deletedCount:0,orphanCount:0});expect(files.size).toBe(1);
    state.now=new Date(start.getTime()+sevenDays);
    expect(await service.cleanupExpiredBackups()).toEqual({deletedCount:1,orphanCount:0});expect(files.size).toBe(0);expect(state.backup.deletedAt).toEqual(state.now);
    expect(state.audits.at(-1)[1]).toBe('DEVICE_RECOVERY_BACKUP_EXPIRED');
    expect(await service.cleanupExpiredBackups()).toEqual({deletedCount:0,orphanCount:0});
  });
  it('cleanup disk failure preserves metadata for retry; protected orphan references are not removed',async()=>{
    await revoke();state.now=new Date(start.getTime()+sevenDays);store.remove.mockRejectedValueOnce(new Error('disk'));
    await expect(service.cleanupExpiredBackups()).rejects.toMatchObject({status:500});expect(state.backup.deletedAt).toBeNull();
    repository.expiredIds.mockResolvedValue([]);store.orphanCandidates.mockResolvedValue(['recovery-file:orphan.enc']);repository.referenced.mockResolvedValue(true);
    store.remove.mockClear();expect(await service.cleanupExpiredBackups()).toEqual({deletedCount:0,orphanCount:0});expect(store.remove).not.toHaveBeenCalled();
  });
  it('retries cleanup safely if file deletion succeeds but audit/metadata transaction fails',async()=>{
    await revoke();state.now=new Date(start.getTime()+sevenDays);tx.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.cleanupExpiredBackups()).rejects.toMatchObject({status:500});
    expect(files.size).toBe(0);expect(state.backup.deletedAt).toBeNull();
    expect(await service.cleanupExpiredBackups()).toEqual({deletedCount:1,orphanCount:0});
    expect(state.backup.deletedAt).toEqual(state.now);
  });
  it('returns public recovery/reset metadata without backup refs or secret content',async()=>{
    await revoke();const result=await service.getRecovery(admin,'42');expect(result.backups[0]).toMatchObject({backupId:'30'});
    expect(JSON.stringify(result)).not.toMatch(/uri|checksum|keyRef|Old name/);
    expect(await service.getResetStatus(admin,'42')).toMatchObject({jobId:'40',status:'PENDING',acknowledgedAt:null});
  });
  it('denies non-Admin, disabled Admin, malformed idempotency key and unapproved reset contract',async()=>{
    await expect(service.revokeDeviceAssignment(user,'42',{},'revoke_request_0001')).rejects.toMatchObject({status:403});
    await expect(service.restoreDeviceAssignment(user,'30')).rejects.toMatchObject({status:403});
    await expect(service.revokeDeviceAssignment(admin,'42',{},undefined)).rejects.toMatchObject({status:400});
    tx.ownership.devices.users.findUserRoles.mockResolvedValue([{code:'USER'}]);await expect(revoke()).rejects.toMatchObject({status:403});
    config.set('RESET_CONTRACT_APPROVED','false');await expect(service.requestDeviceReset({deviceId:'42'})).rejects.toMatchObject({status:403});
  });
  it('requires explicit retry lease and rejects restore when former owner becomes ineligible',async()=>{
    await completeReset();config.set('DEVICE_RESET_RETRY_SECONDS','');await expect(service.requestDeviceReset({deviceId:'42'})).rejects.toMatchObject({status:409});
    tx.ownership.devices.users.findByIdForUpdate.mockImplementation(async(id:string)=>({id,status:id==='7'?'disabled':'active',email_verified_at:start}));
    await expect(service.restoreDeviceAssignment(admin,'30')).rejects.toMatchObject({status:409});
  });
});

describe('Recovery transaction SQL and DTO safeguards',()=>{
  let c:any;let tx:RecoveryTransaction;let repo:RecoveryRepository;
  beforeEach(()=>{c={execute:jest.fn().mockResolvedValue([[]]),query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    const pool={getConnection:jest.fn().mockResolvedValue(c),execute:c.execute};repo=new RecoveryRepository(pool as never);tx=new RecoveryTransaction(pool as never,c);});
  it('revoke targets only device assignment/credentials/codes/history and creates pending job',async()=>{
    c.execute.mockResolvedValueOnce([{}]);c.execute.mockImplementation(async(sql:string)=>sql.includes('LAST_INSERT_ID')?[[{id:'40'}]]:[{}]);
    await tx.revoke({deviceId:'42',userId:'7',pairingRequestId:'9',assignedBy:'1',assignedAt:start},'20','10','1',null,start);
    const sql=c.execute.mock.calls.map((v:any[])=>v[0]).join('\n');
    expect(sql).toContain('DELETE FROM device_assignments WHERE device_id=? AND user_id=? AND pairing_request_id=?');
    expect(sql).toContain('UPDATE device_credentials');expect(sql).toContain('INSERT INTO device_reset_jobs');
    expect(sql).not.toMatch(/UPDATE users|DELETE FROM users|UPDATE ai_profiles|connection_status/);
  });
  it('uses seven-day database expiry and full BIGINT IDs',async()=>{
    c.execute.mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{id:'9007199254740993'}]]);
    expect(await tx.insertBackup('10',{uri:'recovery-file:test.enc',checksum:'hash',keyRef:'test'},start)).toBe('9007199254740993');
    expect(c.execute.mock.calls[0][0]).toContain('DATE_ADD(?,INTERVAL 7 DAY)');
  });
  it('rollback on work/commit failure and always release',async()=>{
    await repo.transaction(async()=>true);expect(c.commit).toHaveBeenCalled();
    await expect(repo.transaction(async()=>{throw new Error('backup');})).rejects.toThrow('backup');
    c.commit.mockRejectedValue(new Error('commit'));await expect(repo.transaction(async()=>true)).rejects.toThrow('commit');
    expect(c.rollback).toHaveBeenCalledTimes(2);expect(c.release).toHaveBeenCalledTimes(3);
  });
  it.each([{deviceId:'42',attempt:0,challenge:'x'.repeat(43),result:'success'},
    {deviceId:'42',attempt:1,challenge:'x'.repeat(43),result:'success',sessionsInvalidated:true,firmwareResetConfirmed:false},
    {deviceId:'42',attempt:1,challenge:'x'.repeat(43),result:'failed',failureCode:'raw private error'}])('rejects invalid ACK %j',body=>expect(()=>ackInput(body)).toThrow());
  it('rejects unknown revoke fields and invalid reason',()=>{
    expect(()=>revokeInput({userId:'8'},'revoke_request_0001')).toThrow();expect(()=>revokeInput({reason:'x'.repeat(501)},'revoke_request_0001')).toThrow();
  });
});
