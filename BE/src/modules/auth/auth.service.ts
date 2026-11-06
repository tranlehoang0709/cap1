import { createHash, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthRepository } from './auth.repository';
import { EmailVerificationService } from './email-verification.service';
import { AccessTokenPayload, EmailVerificationPayload, RefreshTokenPayload, TokenPair } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly verification?: EmailVerificationService,
  ) {}

  async register(email: string, displayName: string, password: string, actorId: string | null = null): Promise<{ id: string; email: string; display_name: string; verification_token: string }> {
    if (Buffer.byteLength(password, 'utf8') > 72) throw new BadRequestException('Password must be at most 72 UTF-8 bytes');
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const user = await this.repository.createUser(normalizedEmail, displayName.trim(), passwordHash, actorId);
      return { id: user.id, email: user.email, display_name: user.display_name, verification_token: await this.createEmailVerificationToken(user.id) };
    } catch (error) {
      if (this.isDuplicate(error)) throw new ConflictException('Email is already registered');
      throw error;
    }
  }

  async resendVerification(email: string) {
    if (!this.verification) throw new ServiceUnavailableException('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE');
    return this.verification.resend(email, id => this.createEmailVerificationToken(id));
  }

  async verifyEmail(token: string): Promise<{ success: true }> {
    let payload: EmailVerificationPayload;
    try {
      payload = await this.jwt.verifyAsync<EmailVerificationPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'), issuer: 'aiva-iot', audience: 'aiva-email-verification',
      });
      if (payload.typ !== 'email_verification' || !payload.sub) throw new Error('Invalid verification token');
    } catch {
      throw new BadRequestException('Invalid or expired email verification token');
    }
    if (!await this.repository.verifyEmail(payload.sub)) throw new BadRequestException('User account was not found');
    return { success: true };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.repository.findCredentialsByEmail(email.trim().toLowerCase());
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !validPassword) throw new UnauthorizedException('Email or password is incorrect');
    const canLogin = await this.users.canLogin(user.id);
    if (!canLogin.allowed) throw new UnauthorizedException('This account cannot sign in');
    await this.repository.updateLastLogin(user.id);
    const tokens = await this.issueTokens(user.id);
    await this.repository.createRefreshSession(user.id, this.hashToken(tokens.refresh_token), this.expirationDate('refreshTokenTtlSeconds'));
    return tokens;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefresh(refreshToken);
    const oldHash = this.hashToken(refreshToken);
    const nextRefresh = await this.createRefreshToken(payload.sub);
    const access = await this.createAccessToken(payload.sub);
    const newHash = this.hashToken(nextRefresh.token);
    const rotated = await this.repository.rotateRefreshSession(oldHash, newHash, nextRefresh.expiresAt);
    if (!rotated) throw new UnauthorizedException('Refresh token is expired, revoked, or already used');
    return { access_token: access.token, refresh_token: nextRefresh.token, token_type: 'Bearer', expires_in: access.ttl };
  }

  async logout(userId: string, refreshToken: string): Promise<{ success: true }> {
    const payload = await this.verifyRefresh(refreshToken);
    if (payload.sub !== userId) throw new UnauthorizedException('Refresh token does not belong to this account');
    await this.repository.revokeRefreshSession(this.hashToken(refreshToken));
    return { success: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ success: true }> {
    const user = await this.repository.findCredentialsById(userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new BadRequestException('New password must differ from current password');
    await this.repository.changePassword(userId, await bcrypt.hash(newPassword, 12));
    return { success: true };
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const [access, refresh] = await Promise.all([this.createAccessToken(userId), this.createRefreshToken(userId)]);
    return { access_token: access.token, refresh_token: refresh.token, token_type: 'Bearer', expires_in: access.ttl };
  }

  private async createAccessToken(userId: string): Promise<{ token: string; ttl: number }> {
    const ttl = this.config.getOrThrow<number>('auth.accessTokenTtlSeconds');
    const payload: AccessTokenPayload = { sub: userId, typ: 'access' };
    return {
      token: await this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'), expiresIn: ttl,
        issuer: 'aiva-iot', audience: 'aiva-api',
      }),
      ttl,
    };
  }

  private async createEmailVerificationToken(userId: string): Promise<string> {
    return this.jwt.signAsync<EmailVerificationPayload>({ sub: userId, typ: 'email_verification' }, {
      secret: this.config.getOrThrow<string>('auth.accessTokenSecret'), expiresIn: 900,
      issuer: 'aiva-iot', audience: 'aiva-email-verification',
    });
  }

  private async createRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const ttl = this.config.getOrThrow<number>('auth.refreshTokenTtlSeconds');
    const payload: RefreshTokenPayload = { sub: userId, typ: 'refresh', jti: randomUUID() };
    return {
      token: await this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('auth.refreshTokenSecret'), expiresIn: ttl,
        issuer: 'aiva-iot', audience: 'aiva-refresh',
      }),
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  private async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.refreshTokenSecret'), issuer: 'aiva-iot', audience: 'aiva-refresh',
      });
      if (payload.typ !== 'refresh' || !payload.sub || !payload.jti) throw new Error('Invalid refresh token');
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const canLogin = await this.users.canLogin(payload.sub);
    if (!canLogin.allowed) throw new UnauthorizedException('This account cannot sign in');
    return payload;
  }

  private hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private expirationDate(key: 'refreshTokenTtlSeconds'): Date {
    return new Date(Date.now() + this.config.getOrThrow<number>(`auth.${key}`) * 1000);
  }
  private isDuplicate(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
  }
}
