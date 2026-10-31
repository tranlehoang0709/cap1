import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class InternalDeviceGuard implements CanActivate {
  constructor(private readonly config:ConfigService) {}
  canActivate(context:ExecutionContext):boolean {
    const header=context.switchToHttp().getRequest<{headers:{authorization?:string}}>().headers.authorization;
    const expected=this.config.get<string>('AI_DEVICE_SERVICE_TOKEN');
    const token=typeof header==='string' && header.length<=1024 ? /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(header)?.[1] : undefined;
    if (!expected || !/^[A-Za-z0-9_-]{43,128}$/.test(expected) || !token
      || !timingSafeEqual(createHash('sha256').update(token).digest(),createHash('sha256').update(expected).digest())) {
      throw new UnauthorizedException({allowed:false,reason:'SERVICE_UNAUTHORIZED'});
    }
    if (this.config.get<string>('DEVICE_AUTH_CONTRACT_APPROVED')!=='true') {
      throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    }
    return true;
  }
}
