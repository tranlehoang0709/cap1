import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiServerServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const configured = this.config.get<string>('internal.aiServerServiceToken') ?? '';
    const supplied = request.headers['x-ai-server-token'] ?? request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!configured || !supplied || supplied.length !== configured.length || supplied !== configured) {
      throw new UnauthorizedException('AI Server service authentication required');
    }
    return true;
  }
}
