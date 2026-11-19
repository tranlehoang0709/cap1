import { BadRequestException, Controller, Get, Headers, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { CalendarService } from './calendar.service';
import { ToolDelegationQueryDto } from './tool-execution.dto';

@Controller('internal/tool-execution')
export class ToolExecutionController {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService,
    private readonly users: UsersService, private readonly calendar: CalendarService) {}

  @Public()
  @Get('schedule')
  async schedule(@Headers('authorization') authorization: string | undefined,
    @Headers('x-ai-tool-service') serviceToken: string | undefined,
    @Query() query: ToolDelegationQueryDto) {
    const expected = this.config.get<string>('toolExecution.serviceToken') ?? '';
    if (!expected || !serviceToken || serviceToken !== expected) {
      throw new UnauthorizedException('Tool service authentication required');
    }
    const [scheme, token] = (authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Delegation required');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string; scope: string; sid: string }>(token, {
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'),
        issuer: 'aiva-iot', audience: 'aiva-backend-tool-execution',
      });
      if (payload.typ !== 'tool_delegation' || payload.scope !== 'schedule.query' || !payload.sub || !payload.sid) throw new Error();
      if (payload.sid !== query.session_id) throw new Error();
      const user = await this.users.getUserById(payload.sub);
      const role = await this.users.getUserRole(payload.sub);
      if (user.status !== 'active' || !user.email_verified_at) throw new Error();
      return this.calendar.listEvents({ id: user.id, email: user.email, display_name: user.display_name, role }, query.from, query.to);
    } catch {
      throw new UnauthorizedException('Invalid or expired delegation');
    }
  }
}
