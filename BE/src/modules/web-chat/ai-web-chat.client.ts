import { BadGatewayException, GatewayTimeoutException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AIWebReply { content: string; conversation_id: string; usage: { input_tokens: number; output_tokens: number }; }

/** BE-only caller. Never retries generation, follows redirects or persists estimated usage. */
@Injectable()
export class AIWebChatClient {
  constructor(private readonly config: ConfigService) {}
  async send(userId: string, content: string): Promise<AIWebReply> {
    let origin: URL;
    const token = this.config.get<string>('AI_SERVER_WEB_TOKEN');
    try {
      origin = new URL(this.config.get<string>('AI_SERVER_URL') ?? '');
      const host = origin.hostname.replace(/^\[|\]$/g, '');
      const loopback = host === '127.0.0.1' || host === '::1';
      if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) ||
          origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
          !token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error();
    } catch { throw new ServiceUnavailableException('AI_SERVER_NOT_CONFIGURED'); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 95000);
    try {
      const response = await fetch(new URL('/internal/web-chat', origin), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ userId, content }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpException('AI_SERVER_RATE_LIMITED', 429);
        if (response.status === 504) throw new GatewayTimeoutException('AI_SERVER_TIMEOUT');
        if (response.status === 503) throw new ServiceUnavailableException('AI_SERVER_UNAVAILABLE');
        throw new BadGatewayException('AI_SERVER_REQUEST_FAILED');
      }
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body) {
        await response.body?.cancel();
        throw new BadGatewayException('AI_SERVER_INVALID_RESPONSE');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.length;
          if (size > 70000) {
            await reader.cancel();
            throw new BadGatewayException('AI_SERVER_INVALID_RESPONSE');
          }
          chunks.push(result.value);
        }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AIWebReply;
      if (!data || typeof data.content !== 'string' || !data.content.trim() || [...data.content].length > 500 ||
          typeof data.conversation_id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(data.conversation_id) ||
          BigInt(data.conversation_id) > 9223372036854775807n || !data.usage ||
          !Number.isSafeInteger(data.usage.input_tokens) || data.usage.input_tokens < 0 ||
          !Number.isSafeInteger(data.usage.output_tokens) || data.usage.output_tokens < 0) {
        throw new BadGatewayException('AI_SERVER_INVALID_RESPONSE');
      }
      return { content: data.content, conversation_id: data.conversation_id,
        usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (controller.signal.aborted) throw new GatewayTimeoutException('AI_SERVER_TIMEOUT');
      throw new BadGatewayException('AI_SERVER_REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  }
}
