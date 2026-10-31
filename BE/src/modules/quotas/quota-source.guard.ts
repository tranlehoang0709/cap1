import { CanActivate,ExecutionContext,Injectable,UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash,timingSafeEqual } from 'node:crypto';
@Injectable()
export class QuotaSourceGuard implements CanActivate {
  constructor(private readonly config:ConfigService){}
  canActivate(context:ExecutionContext){
    const header=context.switchToHttp().getRequest<{headers:{authorization?:string}}>().headers.authorization;
    const token=typeof header==='string'&&header.length<=1024?/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(header)?.[1]:undefined;
    const expected=this.config.get<string>('AI_QUOTA_SERVICE_TOKEN');
    if(!token||!expected||!/^[A-Za-z0-9_-]{43,128}$/.test(expected)||!timingSafeEqual(createHash('sha256').update(token).digest(),createHash('sha256').update(expected).digest()))throw new UnauthorizedException({allowed:false,reason:'SERVICE_UNAUTHORIZED'});
    return true;
  }
}
