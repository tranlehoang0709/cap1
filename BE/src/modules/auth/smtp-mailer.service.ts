import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

@Injectable()
export class SmtpMailerService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const s = this.readSettings();
    if (!s.host || !s.from) return false;
    if ((s.user && !s.pass) || (!s.user && s.pass)) return false;
    return true;
  }

  async sendVerificationOtp(email: string, otp: string): Promise<void> {
    await this.sendMail({
      to: email,
      subject: '[AIVA-IoT] Mã xác minh email của bạn',
      text: [
        'Xin chào,',
        '',
        `Mã xác minh email AIVA-IoT của bạn là: ${otp}`,
        'Mã có hiệu lực trong 5 phút và chỉ sử dụng một lần.',
        '',
        'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.',
      ].join('\r\n'),
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.sendMail({
      to: email,
      subject: '[AIVA-IoT] Mã khôi phục mật khẩu',
      text: [
        'Xin chào,',
        '',
        `Mã khôi phục mật khẩu AIVA-IoT của bạn là: ${otp}`,
        'Mã có hiệu lực trong 5 phút và chỉ sử dụng một lần.',
        '',
        'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
      ].join('\r\n'),
    });
  }

  async sendMail(options: { to: string; subject: string; text: string }): Promise<void> {
    const settings = this.readSettings();
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Dịch vụ gửi email SMTP chưa được cấu hình.');
    }

    const envelopeFrom = this.extractAddress(settings.from);
    const envelopeTo = this.extractAddress(options.to);
    if (!envelopeFrom || !envelopeTo) {
      throw new ServiceUnavailableException('Cấu hình địa chỉ email SMTP không hợp lệ.');
    }

    const ehloHost = 'aiva-iot.local';
    let socket: net.Socket | tls.TLSSocket = settings.secure
      ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host })
      : net.createConnection({ host: settings.host, port: settings.port });

    socket.setTimeout(10_000);

    try {
      await this.waitConnect(socket, settings.secure);
      const reader = this.createLineReader(socket);

      await this.expectCode(reader, [220]);
      let ehlo = await this.command(socket, reader, `EHLO ${ehloHost}`, [250]);

      if (!settings.secure && ehlo.some((line) => /\bSTARTTLS\b/i.test(line))) {
        await this.command(socket, reader, 'STARTTLS', [220]);
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('close');

        const upgraded = tls.connect({ socket, servername: settings.host });
        upgraded.setTimeout(10_000);
        await this.waitConnect(upgraded, true);
        socket = upgraded;
        const tlsReader = this.createLineReader(socket);
        ehlo = await this.command(socket, tlsReader, `EHLO ${ehloHost}`, [250]);
        await this.authenticateIfNeeded(socket, tlsReader, settings, ehlo);
        await this.transmitMessage(socket, tlsReader, envelopeFrom, envelopeTo, settings.from, options);
        return;
      }

      await this.authenticateIfNeeded(socket, reader, settings, ehlo);
      await this.transmitMessage(socket, reader, envelopeFrom, envelopeTo, settings.from, options);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Không thể gửi email qua máy chủ SMTP.');
    } finally {
      socket.destroy();
    }
  }

  private async authenticateIfNeeded(
    socket: net.Socket | tls.TLSSocket,
    reader: () => Promise<{ code: number; lines: string[] }>,
    settings: SmtpSettings,
    ehloLines: string[],
  ): Promise<void> {
    if (!settings.user && !settings.pass) return;
    const authCaps = ehloLines.find((line) => /\bAUTH\b/i.test(line)) ?? '';
    if (/\bPLAIN\b/i.test(authCaps) || !/\bLOGIN\b/i.test(authCaps)) {
      const token = Buffer.from(`\0${settings.user}\0${settings.pass}`, 'utf8').toString('base64');
      await this.command(socket, reader, `AUTH PLAIN ${token}`, [235]);
      return;
    }
    await this.command(socket, reader, 'AUTH LOGIN', [334]);
    await this.command(socket, reader, Buffer.from(settings.user, 'utf8').toString('base64'), [334]);
    await this.command(socket, reader, Buffer.from(settings.pass, 'utf8').toString('base64'), [235]);
  }

  private async transmitMessage(
    socket: net.Socket | tls.TLSSocket,
    reader: () => Promise<{ code: number; lines: string[] }>,
    envelopeFrom: string,
    envelopeTo: string,
    headerFrom: string,
    options: { to: string; subject: string; text: string },
  ): Promise<void> {
    await this.command(socket, reader, `MAIL FROM:<${envelopeFrom}>`, [250]);
    await this.command(socket, reader, `RCPT TO:<${envelopeTo}>`, [250, 251]);
    await this.command(socket, reader, 'DATA', [354]);

    const encodedSubject = `=?UTF-8?B?${Buffer.from(options.subject, 'utf8').toString('base64')}?=`;
    const domain = envelopeFrom.split('@')[1] || 'aiva-iot.local';
    const rawMessage = [
      `From: ${headerFrom}`,
      `To: <${envelopeTo}>`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      options.text,
    ]
      .join('\r\n')
      .replace(/^\./gm, '..');

    await this.writeRaw(socket, `${rawMessage}\r\n.\r\n`);
    await this.expectCode(reader, [250]);
    await this.command(socket, reader, 'QUIT', [221]).catch(() => undefined);
  }

  private readSettings(): SmtpSettings {
    const host = (this.config.get<string>('smtp.host') ?? '').trim();
    const port = Number(this.config.get<number>('smtp.port') ?? 587);
    const secure = Boolean(this.config.get<boolean>('smtp.secure') ?? false);
    const user = (this.config.get<string>('smtp.user') ?? '').trim();
    const pass = this.config.get<string>('smtp.pass') ?? '';
    const from = (this.config.get<string>('smtp.from') ?? '').trim();
    return { host, port, secure, user, pass, from };
  }

  private extractAddress(input: string): string {
    const match = input.match(/<([^<>\s]+@[^<>\s]+)>/);
    const raw = (match ? match[1] : input).trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw)) return '';
    return raw;
  }

  private waitConnect(socket: net.Socket | tls.TLSSocket, secure: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const event = secure ? 'secureConnect' : 'connect';
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error('SMTP connection timed out'));
      };
      const cleanup = () => {
        socket.off(event, onConnect);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
      };
      socket.once(event, onConnect);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });
  }

  private createLineReader(socket: net.Socket | tls.TLSSocket): () => Promise<{ code: number; lines: string[] }> {
    let buffer = '';
    const queuedLines: string[] = [];
    let pendingResolve: ((line: string) => void) | null = null;
    let pendingReject: ((err: Error) => void) | null = null;
    let terminalError: Error | null = null;

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          pendingReject = null;
          resolve(line);
        } else {
          queuedLines.push(line);
        }
      }
    });

    const fail = (err: Error) => {
      terminalError = err;
      if (pendingReject) {
        const reject = pendingReject;
        pendingResolve = null;
        pendingReject = null;
        reject(err);
      }
    };

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('SMTP socket timeout')));
    socket.on('close', () => fail(new Error('SMTP connection closed unexpectedly')));

    const nextLine = (): Promise<string> => {
      if (queuedLines.length > 0) return Promise.resolve(queuedLines.shift()!);
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    };

    return async () => {
      const lines: string[] = [];
      while (true) {
        const line = await nextLine();
        lines.push(line);
        const match = line.match(/^(\d{3})([ -])/);
        if (!match) throw new Error(`Invalid SMTP response: ${line}`);
        if (match[2] === ' ') {
          return { code: Number(match[1]), lines };
        }
      }
    };
  }

  private async command(
    socket: net.Socket | tls.TLSSocket,
    reader: () => Promise<{ code: number; lines: string[] }>,
    line: string,
    expectedCodes: number[],
  ): Promise<string[]> {
    await this.writeRaw(socket, `${line}\r\n`);
    return this.expectCode(reader, expectedCodes);
  }

  private async expectCode(
    reader: () => Promise<{ code: number; lines: string[] }>,
    expectedCodes: number[],
  ): Promise<string[]> {
    const response = await reader();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`Unexpected SMTP status ${response.code}`);
    }
    return response.lines;
  }

  private writeRaw(socket: net.Socket | tls.TLSSocket, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.write(payload, 'utf8', (err) => (err ? reject(err) : resolve()));
    });
  }
}
