import { CanActivate,ExecutionContext,ForbiddenException,Injectable,UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash,timingSafeEqual } from 'node:crypto';
import { AccessRoleGuard } from '../auth/access-role.guard';
import { UsersService } from '../users/users.service';

@Injectable()
export class AIActorGuard extends AccessRoleGuard {
  constructor(config:ConfigService,users:UsersService){super(config,users);}
}
@Injectable()
export class InternalAIConfigGuard implements CanActivate {
  constructor(private readonly config:ConfigService){}
  canActivate(context:ExecutionContext):boolean{
    const value=context.switchToHttp().getRequest<{headers:{authorization?:string}}>().headers.authorization;
    const token=typeof value==='string'&&value.length<=1024?/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(value)?.[1]:undefined;
    const expected=this.config.get<string>('AI_CONFIG_SERVICE_TOKEN');
    if(!expected||!/^[A-Za-z0-9_-]{43,128}$/.test(expected)||!token||!timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(token).digest())){
      throw new UnauthorizedException({allowed:false,reason:'SERVICE_UNAUTHORIZED'});
    }
    if(this.config.get<string>('AI_CONFIG_CONTRACT_APPROVED')!=='true')throw new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'});
    return true;
  }
}
