import { ConflictException,Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { open,readFile,unlink,stat,readdir,realpath } from 'node:fs/promises';
import { isAbsolute,join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { SecretEncryptionService } from '../api-keys/secret-encryption.service';

export interface BackupContent {
  version:1;deviceId:string;formerUserId:string;displayName:string|null;
  assignment:{userId:string;pairingRequestId:string;assignedBy:string;assignedAt:string};
}
export interface StoredBackup {uri:string;checksum:string;keyRef:string}
@Injectable()
export class RecoveryStore {
  constructor(private readonly config:ConfigService,private readonly encryption:SecretEncryptionService){}
  private async directory(){
    const root=this.config.get<string>('RECOVERY_BACKUP_DIRECTORY');
    if(this.config.get<string>('RECOVERY_STORAGE_APPROVED')!=='true'||!root||!isAbsolute(root))throw new ConflictException('RECOVERY_STORAGE_NOT_CONFIGURED');
    const resolved=await realpath(root);if(!(await stat(resolved)).isDirectory())throw new ConflictException('RECOVERY_STORAGE_NOT_CONFIGURED');
    return resolved;
  }
  private name(uri:string){const match=/^recovery-file:([a-f0-9-]{36}\.enc)$/.exec(uri);if(!match)throw new ConflictException('INVALID_BACKUP_REFERENCE');return match[1];}
  async createRecoveryBackup(content:BackupContent,operationId:string):Promise<StoredBackup>{
    const root=await this.directory();const name=`${randomUUID()}.enc`;
    const envelope=this.encryption.encrypt(JSON.stringify(content),`RECOVERY:${content.deviceId}:${operationId}`);
    const bytes=Buffer.from(envelope,'utf8');const checksum=createHash('sha256').update(bytes).digest('hex');
    const file=await open(join(root,name),'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    // Persist the directory entry where supported. Windows durability/ACL semantics
    // must be validated by the operator before approving this storage volume.
    if(process.platform!=='win32'){const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}}
    // Verify persisted encrypted bytes before any assignment removal is committed.
    if(createHash('sha256').update(await readFile(join(root,name))).digest('hex')!==checksum)throw new ConflictException('BACKUP_DURABILITY_CHECK_FAILED');
    return {uri:`recovery-file:${name}`,checksum,keyRef:envelope.split('.')[1]};
  }
  async read(backup:StoredBackup,deviceId:string,operationId:string):Promise<BackupContent>{
    const bytes=await readFile(join(await this.directory(),this.name(backup.uri)));
    if(bytes.length>65536||createHash('sha256').update(bytes).digest('hex')!==backup.checksum)throw new ConflictException('BACKUP_INTEGRITY_FAILED');
    const envelope=bytes.toString('utf8');if(envelope.split('.')[1]!==backup.keyRef)throw new ConflictException('BACKUP_INTEGRITY_FAILED');
    return JSON.parse(this.encryption.decrypt(envelope,`RECOVERY:${deviceId}:${operationId}`)) as BackupContent;
  }
  async remove(uri:string){
    const path=join(await this.directory(),this.name(uri));
    try{await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  async orphanCandidates(now:Date):Promise<string[]>{
    const root=await this.directory();const result:string[]=[];
    for(const name of await readdir(root)){
      if(!/^[a-f0-9-]{36}\.enc$/.test(name))continue;
      const info=await stat(join(root,name));
      if(info.isFile()&&info.mtimeMs<=now.getTime()-7*86400000)result.push(`recovery-file:${name}`);
    }
    return result;
  }
}
