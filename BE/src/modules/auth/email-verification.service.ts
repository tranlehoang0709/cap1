import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthRepository } from './auth.repository';

export const RESEND_ACCEPTED = { message: 'Nếu tài khoản đủ điều kiện, hướng dẫn xác minh sẽ được gửi.' };

/** Development single-process limiter. No cross-process or restart guarantee. */
@Injectable()
export class VerificationResendLimiter {
  private readonly attempts = new Map<string, number[]>();
  claim(email: string, now = Date.now()): boolean {
    for (const [key, times] of this.attempts) {
      if (times[times.length - 1] <= now - 3_600_000) this.attempts.delete(key);
    }
    const key = createHash('sha256').update(email).digest('hex');
    const times = (this.attempts.get(key) ?? []).filter(time => time > now - 3_600_000);
    if (times.length >= 3 || times.length && now - times[times.length - 1] < 60_000) return false;
    if (!this.attempts.has(key) && this.attempts.size >= 10_000) {
      throw new ServiceUnavailableException('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE');
    }
    this.attempts.set(key, [...times, now]);
    return true;
  }
}

export const VERIFICATION_CONSOLE = Symbol('VERIFICATION_CONSOLE');
export interface VerificationConsole {
  isTTY?: boolean;
  write(text: string, callback: (error?: Error | null) => void): unknown;
}

@Injectable()
export class EmailVerificationDelivery {
  constructor(private readonly config: ConfigService,
    @Optional() @Inject(VERIFICATION_CONSOLE) private readonly output?: VerificationConsole) {}
  private console(): VerificationConsole { return this.output ?? process.stdout; }
  private frontendUrl(): URL {
    try {
      const url = new URL(this.config.get<string>('EMAIL_VERIFICATION_FRONTEND_URL') ?? '');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
      return url;
    } catch { throw new ServiceUnavailableException('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE'); }
  }
  assertReady(): void {
    if (this.config.get<string>('NODE_ENV') !== 'development' ||
        this.config.get<string>('EMAIL_VERIFICATION_DELIVERY') !== 'development-console' || this.console().isTTY !== true) {
      throw new ServiceUnavailableException('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE');
    }
    this.frontendUrl();
  }
  async send(token: string): Promise<void> {
    this.assertReady();
    const url = this.frontendUrl();
    url.hash = 'verify-email=' + encodeURIComponent(token);
    // Deliberate operator-only TTY output. Never Nest Logger, file, HTTP response or redirected stdout.
    await new Promise<void>((resolve, reject) => {
      this.console().write('AIVA local email verification (expires in 15 minutes; do not share/log):\n' + url.toString() + '\n',
        error => error ? reject(new ServiceUnavailableException('EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE')) : resolve());
    });
  }
}

@Injectable()
export class EmailVerificationService {
  constructor(private readonly repository: AuthRepository, private readonly delivery: EmailVerificationDelivery,
              private readonly limiter: VerificationResendLimiter) {}
  async resend(email: string, issue: (id: string) => Promise<string>): Promise<typeof RESEND_ACCEPTED> {
    // Uniform availability check before account lookup; never claim delivery when no channel exists.
    this.delivery.assertReady();
    const normalized = email.trim().toLowerCase();
    if (!this.limiter.claim(normalized)) return { ...RESEND_ACCEPTED };
    const user = await this.repository.findEmailVerificationAccount(normalized);
    if (user && user.status === 'active' && user.email_verified_at === null &&
        Number(user.role_count) === 1 && user.role === 'USER') {
      await this.delivery.send(await issue(user.id));
    }
    return { ...RESEND_ACCEPTED };
  }
}
