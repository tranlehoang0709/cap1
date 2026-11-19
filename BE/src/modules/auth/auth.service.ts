import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthRepository, OtpPurpose } from './auth.repository';
import { AccessTokenPayload, RefreshTokenPayload, TokenPair } from './auth.types';
import { SmtpMailerService } from './smtp-mailer.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_RESEND_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly repository: AuthRepository,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly mailer?: SmtpMailerService,
  ) {}

  async register(
    email: string,
    displayName: string,
    password: string,
    actorId: string | null = null,
  ): Promise<{ id: string; email: string; display_name: string; verification_sent: boolean }> {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('Mật khẩu tối đa 72 byte UTF-8.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    let user: { id: string; email: string; display_name: string };
    try {
      user = await this.repository.createUser(normalizedEmail, displayName.trim(), passwordHash, actorId);
    } catch (error) {
      if (this.isDuplicate(error)) throw new ConflictException('Email đã được đăng ký.');
      throw error;
    }

    let verificationSent = false;
    if (this.mailer?.isConfigured()) {
      const otp = this.generateOtp();
      const otpHash = this.hashOtp('email_verification', user.id, normalizedEmail, otp);
      await this.repository.createEmailOtp(
        user.id,
        'email_verification',
        otpHash,
        new Date(Date.now() + OTP_TTL_MS),
        OTP_MAX_ATTEMPTS,
      );
      this.logOtp('stored', user.id);
      await this.mailer.sendVerificationOtp(normalizedEmail, otp);
      this.logOtp('sent', user.id);
      verificationSent = true;
    }

    return { id: user.id, email: user.email, display_name: user.display_name, verification_sent: verificationSent };
  }

  async verifyEmail(email: string, code: string): Promise<{ success: true; already_verified?: boolean }> {
    try {
      return await this.verifyEmailCode(email, code);
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        // Do not log exception objects: drivers may include SQL parameters/secrets.
        this.logger.error('email_otp outcome=internal_error');
      }
      throw error;
    }
  }

  private async verifyEmailCode(email: string, code: string): Promise<{ success: true; already_verified?: boolean }> {
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      this.logOtp('invalid_format');
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Mã OTP phải gồm đúng 6 chữ số.' });
    }

    const user = await this.repository.findCredentialsByEmail(normalizedEmail);
    if (!user) {
      this.logOtp('account_not_found');
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    }
    if (user.email_verified_at !== null) {
      this.logOtp('already_verified', user.id);
      return { success: true, already_verified: true };
    }

    const record = await this.repository.findLatestPendingEmailOtp(user.id, 'email_verification');
    if (!record) {
      this.logOtp(await this.repository.emailOtpOutcome(user.id, 'email_verification'), user.id);
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    }
    if (record.expires_at.getTime() <= Date.now()) {
      this.logOtp('expired', user.id, record.id);
      await this.repository.invalidatePendingEmailOtps(user.id, 'email_verification');
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: 'Mã OTP đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.' });
    }
    if (record.attempts >= record.max_attempts) {
      this.logOtp('attempt_limit', user.id, record.id);
      await this.repository.invalidatePendingEmailOtps(user.id, 'email_verification');
      throw new BadRequestException({
        code: 'OTP_TOO_MANY_ATTEMPTS',
        message: 'Bạn đã nhập sai quá số lần cho phép. Vui lòng yêu cầu mã mới.',
      });
    }

    const expectedHash = this.hashOtp('email_verification', user.id, normalizedEmail, trimmedCode);
    if (!this.safeEqualHex(expectedHash, record.code_hash)) {
      this.logOtp('wrong_code', user.id, record.id);
      const updated = await this.repository.incrementEmailOtpAttempt(record.id);
      const remaining = Math.max(0, updated.max_attempts - updated.attempts);
      if (remaining === 0) {
        throw new BadRequestException({
          code: 'OTP_TOO_MANY_ATTEMPTS',
          message: 'Bạn đã nhập sai quá số lần cho phép. Vui lòng yêu cầu mã mới.',
        });
      }
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: `Mã OTP không đúng. Còn ${remaining} lần thử.`,
      });
    }

    const consumed = await this.repository.consumeEmailOtp(record.id);
    if (!consumed) {
      this.logOtp(await this.repository.emailOtpOutcome(user.id, 'email_verification', record.id), user.id, record.id);
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: 'Mã OTP đã hết hạn hoặc đã được sử dụng.' });
    }

    if (!(await this.repository.verifyEmail(user.id))) {
      this.logger.error('email_otp outcome=internal_error stage=update_email_verified');
      throw new BadRequestException('Không tìm thấy tài khoản.');
    }
    this.logOtp('verified', user.id, record.id);
    return { success: true };
  }

  async resendVerification(email: string): Promise<{ success: true; message: string }> {
    if (!this.mailer?.isConfigured()) {
      throw new ServiceUnavailableException('Dịch vụ gửi email SMTP chưa được cấu hình.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findCredentialsByEmail(normalizedEmail);
    if (!user || user.status !== 'active' || user.email_verified_at !== null) {
      return {
        success: true,
        message: 'Nếu tài khoản tồn tại và chưa xác minh, mã OTP mới đã được gửi.',
      };
    }

    const windowSince = new Date(Date.now() - OTP_RESEND_WINDOW_MS);
    const recent = await this.repository.countRecentEmailOtps(user.id, 'email_verification', windowSince);
    if (
      recent.latestCreatedAt &&
      Date.now() - recent.latestCreatedAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw new HttpException(
        { code: 'OTP_RESEND_COOLDOWN', message: 'Vui lòng đợi 60 giây trước khi yêu cầu gửi lại mã OTP.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (recent.count >= OTP_MAX_PER_WINDOW) {
      throw new HttpException(
        { code: 'OTP_RESEND_LIMIT', message: 'Bạn đã yêu cầu gửi lại mã quá nhiều lần. Vui lòng thử lại sau ít phút.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = this.generateOtp();
    const otpHash = this.hashOtp('email_verification', user.id, normalizedEmail, otp);
    await this.repository.createEmailOtp(
      user.id,
      'email_verification',
      otpHash,
      new Date(Date.now() + OTP_TTL_MS),
      OTP_MAX_ATTEMPTS,
    );
    this.logOtp('stored', user.id);
    await this.mailer.sendVerificationOtp(normalizedEmail, otp);
    this.logOtp('sent', user.id);

    return { success: true, message: 'Mã OTP xác minh mới đã được gửi đến email của bạn.' };
  }

  async forgotPassword(email: string): Promise<{ success: true; message: string }> {
    if (!this.mailer?.isConfigured()) {
      throw new ServiceUnavailableException('Dịch vụ gửi email SMTP chưa được cấu hình.');
    }

    const genericMessage = 'Nếu email tồn tại trong hệ thống, mã OTP khôi phục đã được gửi.';
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findCredentialsByEmail(normalizedEmail);

    if (!user || user.status !== 'active') {
      return { success: true, message: genericMessage };
    }

    const windowSince = new Date(Date.now() - OTP_RESEND_WINDOW_MS);
    const recent = await this.repository.countRecentEmailOtps(user.id, 'password_reset', windowSince);
    const inCooldown =
      recent.latestCreatedAt && Date.now() - recent.latestCreatedAt.getTime() < OTP_RESEND_COOLDOWN_MS;
    if (inCooldown || recent.count >= OTP_MAX_PER_WINDOW) {
      return { success: true, message: genericMessage };
    }

    const otp = this.generateOtp();
    const otpHash = this.hashOtp('password_reset', user.id, normalizedEmail, otp);
    await this.repository.createEmailOtp(
      user.id,
      'password_reset',
      otpHash,
      new Date(Date.now() + OTP_TTL_MS),
      OTP_MAX_ATTEMPTS,
    );
    await this.mailer.sendPasswordResetOtp(normalizedEmail, otp);

    return { success: true, message: genericMessage };
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<{ success: true }> {
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException('Mật khẩu tối đa 72 byte UTF-8.');
    }

    const consistentError = () =>
      new BadRequestException({
        code: 'OTP_INVALID_OR_EXPIRED',
        message: 'Mã khôi phục không hợp lệ hoặc đã hết hạn.',
      });

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      throw consistentError();
    }

    const user = await this.repository.findCredentialsByEmail(normalizedEmail);
    if (!user || user.status !== 'active') {
      throw consistentError();
    }

    const record = await this.repository.findLatestPendingEmailOtp(user.id, 'password_reset');
    if (!record) {
      throw consistentError();
    }
    if (record.expires_at.getTime() <= Date.now()) {
      await this.repository.invalidatePendingEmailOtps(user.id, 'password_reset');
      throw consistentError();
    }
    if (record.attempts >= record.max_attempts) {
      await this.repository.invalidatePendingEmailOtps(user.id, 'password_reset');
      throw consistentError();
    }

    const expectedHash = this.hashOtp('password_reset', user.id, normalizedEmail, trimmedCode);
    if (!this.safeEqualHex(expectedHash, record.code_hash)) {
      await this.repository.incrementEmailOtpAttempt(record.id);
      throw consistentError();
    }

    const consumed = await this.repository.consumeEmailOtp(record.id);
    if (!consumed) {
      throw consistentError();
    }

    await this.repository.resetPassword(user.id, await bcrypt.hash(newPassword, 12));
    return { success: true };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.repository.findCredentialsByEmail(email.trim().toLowerCase());
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !validPassword) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    const canLogin = await this.users.canLogin(user.id);
    if (!canLogin.allowed) {
      if (canLogin.reason === 'EMAIL_NOT_VERIFIED') {
        throw new UnauthorizedException({
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Tài khoản chưa xác minh email. Vui lòng xác minh email để tiếp tục.',
        });
      }
      if (canLogin.reason === 'ACCOUNT_SUSPENDED') {
        throw new UnauthorizedException({
          code: 'ACCOUNT_SUSPENDED',
          message: 'Tài khoản đang bị tạm khóa. Vui lòng liên hệ quản trị viên.',
        });
      }
      if (canLogin.reason === 'ACCOUNT_DISABLED') {
        throw new UnauthorizedException({
          code: 'ACCOUNT_DISABLED',
          message: 'Tài khoản đã bị vô hiệu hóa.',
        });
      }
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Tài khoản hiện không thể đăng nhập.',
      });
    }

    await this.repository.updateLastLogin(user.id);
    const tokens = await this.issueTokens(user.id);
    await this.repository.createRefreshSession(
      user.id,
      this.hashToken(tokens.refresh_token),
      this.expirationDate('refreshTokenTtlSeconds'),
    );
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
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'),
        expiresIn: ttl,
        issuer: 'aiva-iot',
        audience: 'aiva-api',
      }),
      ttl,
    };
  }

  private async createRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const ttl = this.config.getOrThrow<number>('auth.refreshTokenTtlSeconds');
    const payload: RefreshTokenPayload = { sub: userId, typ: 'refresh', jti: randomUUID() };
    return {
      token: await this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('auth.refreshTokenSecret'),
        expiresIn: ttl,
        issuer: 'aiva-iot',
        audience: 'aiva-refresh',
      }),
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  private async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.refreshTokenSecret'),
        issuer: 'aiva-iot',
        audience: 'aiva-refresh',
      });
      if (payload.typ !== 'refresh' || !payload.sub || !payload.jti) throw new Error('Invalid refresh token');
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const canLogin = await this.users.canLogin(payload.sub);
    if (!canLogin.allowed) throw new UnauthorizedException('This account cannot sign in');
    return payload;
  }

  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private logOtp(outcome: string, userId?: string, otpId?: string): void {
    this.logger.log(`email_otp outcome=${outcome}${userId ? ` user_id=${userId}` : ''}${otpId ? ` record_id=${otpId}` : ''}`);
  }

  private hashOtp(purpose: OtpPurpose, userId: string, email: string, otp: string): string {
    const secret = this.config.getOrThrow<string>('auth.accessTokenSecret');
    return createHmac('sha256', secret).update(`${purpose}:${userId}:${email}:${otp}`).digest('hex');
  }

  private safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private expirationDate(key: 'refreshTokenTtlSeconds'): Date {
    return new Date(Date.now() + this.config.getOrThrow<number>(`auth.${key}`) * 1000);
  }

  private isDuplicate(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
  }
}
