import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class SecretEncryptionService {
  constructor(private readonly config:ConfigService) {}
  private key() {
    const encoded=this.config.get<string>('AI_SECRET_KEY_BASE64');
    const id=this.config.get<string>('AI_SECRET_KEY_ID');
    if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || !id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new ConflictException('SECRET_ENCRYPTION_NOT_CONFIGURED');
    }
    const key=Buffer.from(encoded,'base64');
    if(key.length!==32)throw new ConflictException('SECRET_ENCRYPTION_NOT_CONFIGURED');
    return {key,id};
  }
  encrypt(secret:string,context:string):string {
    const {key,id}=this.key();const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`v1:${id}:${context}`));
    const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
    return ['v1',id,iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
  }
  decrypt(envelope:string,context:string):string {
    const {key,id}=this.key();
    try {
      const parts=envelope.split('.');
      if(parts.length!==5||parts[0]!=='v1'||parts[1]!==id)throw new Error();
      const iv=Buffer.from(parts[2],'base64url');const tag=Buffer.from(parts[3],'base64url');
      if(iv.length!==12||tag.length!==16)throw new Error();
      const decipher=createDecipheriv('aes-256-gcm',key,iv);
      decipher.setAAD(Buffer.from(`v1:${id}:${context}`));decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(parts[4],'base64url')),decipher.final()]).toString('utf8');
    } catch {throw new ConflictException('CREDENTIAL_UNAVAILABLE');}
  }
}
