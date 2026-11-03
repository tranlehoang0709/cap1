import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_DEVICE_AUTH_KEY } from '../decorators/device-auth.decorator';
import { AccessTokenPayload, AuthenticatedUser } from '../../modules/auth/auth.types';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
      || this.reflector.getAllAndOverride<boolean>(IS_DEVICE_AUTH_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Authentication required');
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'), issuer: 'aiva-iot', audience: 'aiva-api',
      });
      if (payload.typ !== 'access' || !payload.sub) throw new Error('Invalid token type');
      const [user, role] = await Promise.all([this.users.getUserById(payload.sub), this.users.getUserRole(payload.sub)]);
      if (user.status !== 'active' || !user.email_verified_at) throw new Error('Account is not active');
      request.user = { id: user.id, email: user.email, display_name: user.display_name, role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
