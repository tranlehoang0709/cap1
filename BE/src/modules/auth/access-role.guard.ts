import { CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { UsersServiceError } from '../users/users.errors';
import { RoleCode } from '../users/users.types';

export interface CurrentUser { userId: string; role: RoleCode }
export interface AuthenticatedRequest { headers: { authorization?: string }; currentUser: CurrentUser }

/** Access JWT only; never accepts auth_sessions refresh tokens or caller-supplied roles. */
export abstract class AccessRoleGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly users: UsersService, private readonly requiredRole?: RoleCode) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const secret = this.config.get<string>('ADMIN_ACCESS_JWT_SECRET');
    const issuer = this.config.get<string>('ADMIN_ACCESS_JWT_ISSUER');
    const audience = this.config.get<string>('ADMIN_ACCESS_JWT_AUDIENCE');
    const authorization = request.headers.authorization;
    let subject: string;
    try {
      if (!secret || Buffer.byteLength(secret) < 32 || !issuer || !audience
        || typeof authorization !== 'string' || authorization.length > 8192) throw new Error();
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match) throw new Error();
      const [header, payload, signature] = match[1].split('.');
      const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
      if (metadata.alg !== 'HS256' || metadata.typ !== 'JWT' || metadata.crit !== undefined) throw new Error();
      const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(claims.exp) || claims.exp <= now
        || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))
        || claims.iss !== issuer || claims.aud !== audience
        || typeof claims.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(claims.sub)
        || BigInt(claims.sub) > 9223372036854775807n) throw new Error();
      subject = claims.sub;
    } catch {
      throw new UnauthorizedException('A valid access token is required');
    }
    let verifiedRole:RoleCode;
    try {
      const eligibility = await this.users.canLogin(subject);
      const role = await this.users.getUserRole(subject);
      if (!eligibility.allowed || (this.requiredRole && role !== this.requiredRole)) throw new ForbiddenException('Active verified account with the required role is required');
      verifiedRole=role;
    } catch (error) {
      if (error instanceof UsersServiceError && error.code !== 'DATABASE_ERROR') {
        throw new ForbiddenException('Active verified account with the required role is required');
      }
      throw error;
    }
    request.currentUser = { userId: subject, role: verifiedRole };
    return true;
  }
}
