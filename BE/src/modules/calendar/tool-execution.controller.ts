import { BadRequestException, Body, Controller, Get, Headers, Post, Query, ServiceUnavailableException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { CalendarService } from './calendar.service';
import { CalendarRepository } from './calendar.repository';
import { verifyConfirmationProof } from './voice-mutation';
import { ToolDelegatedEventDto, ToolDelegatedDeleteDto, ToolDelegatedEventQueryDto, ToolDelegationQueryDto, ToolAssistantQueryDto } from './tool-execution.dto';
import { DevicesService } from '../devices/devices.service';
import { CalendarConfirmationService } from './confirmation.service';

@Controller('internal/tool-execution')
export class ToolExecutionController {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService,
    private readonly users: UsersService, private readonly calendar: CalendarService,
    private readonly devices: DevicesService, private readonly repository?: CalendarRepository,
    private readonly confirmations?: CalendarConfirmationService) {}

  @Public()
  @Post('event-prepare')
  async eventPrepare(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: any) {
    const owner = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, query.scope);
    if (!this.confirmations || !query.device_id || !body.operation) throw new BadRequestException('Confirmation prepare data required');
    return this.confirmations.prepare({userId:owner.payload.sub,deviceId:query.device_id,sessionId:query.session_id,operation:body.operation,payload:body.payload});
  }

  @Public()
  @Post('event-confirm')
  async eventConfirm(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: any) {
    const owner = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, query.scope);
    if (!this.confirmations || !query.device_id || !body.pending_id || !body.payload) throw new BadRequestException('Confirmation data required');
    return this.confirmations.confirm(body.pending_id, owner.payload.sub, query.device_id, query.session_id, body.payload);
  }

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
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string; scope: string; sid: string; did?: string }>(token, {
        secret: this.config.getOrThrow<string>('auth.accessTokenSecret'),
        issuer: 'aiva-iot', audience: 'aiva-backend-tool-execution',
      });
      if (payload.typ !== 'tool_delegation' || payload.scope !== 'schedule.query' || !payload.sub || !payload.sid) throw new Error();
      if (payload.sid !== query.session_id) throw new Error();
      if (payload.did !== undefined) {
        if (!query.device_id || query.device_id !== payload.did) throw new Error();
        await this.devices.getOwned(payload.sub, payload.did);
      }
      const user = await this.users.getUserById(payload.sub);
      const role = await this.users.getUserRole(payload.sub);
      if (user.status !== 'active' || !user.email_verified_at) throw new Error();
      return this.calendar.listEvents({ id: user.id, email: user.email, display_name: user.display_name, role }, query.from, query.to);
    } catch {
      throw new UnauthorizedException('Invalid or expired delegation');
    }
  }

  @Public()
  @Get('event-query')
  async eventQuery(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto) {
    const { user, payload } = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'event.query');
    return this.calendar.listEvents(user, query.from, query.to);
  }

  @Public()
  @Get('assistant-summary')
  async assistantSummary(@Headers('authorization') authorization: string | undefined,
    @Headers('x-ai-tool-service') serviceToken: string | undefined,
    @Query() query: ToolAssistantQueryDto) {
    const { user } = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'schedule.query');
    if (!this.repository) throw new ServiceUnavailableException('Calendar repository unavailable');
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const events = query.include_events === false ? [] : (await this.calendar.listEvents(user, query.from, query.to)).items;
    const tasks = query.include_tasks === false ? [] : await this.repository.listAssistantTasks(user.id,
      query.mode ?? 'date', from, to);
    return { events, tasks };
  }

  @Public()
  @Get('assistant-report')
  async assistantReport(@Headers('authorization') authorization: string | undefined,
    @Headers('x-ai-tool-service') serviceToken: string | undefined,
    @Query() query: ToolDelegationQueryDto) {
    const { user } = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'schedule.query');
    if (!this.repository || !query.from || !query.to) throw new BadRequestException('Report range required');
    const from = new Date(query.from); const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException('Invalid report range');
    }
    return this.repository.getAssistantTaskReport(user.id, from, to);
  }

  @Public()
  @Get('assistant-plan-progress')
  async assistantPlanProgress(@Headers('authorization') authorization: string | undefined,
    @Headers('x-ai-tool-service') serviceToken: string | undefined,
    @Query() query: ToolDelegationQueryDto) {
    const { user } = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'schedule.query');
    if (!this.repository) throw new ServiceUnavailableException('Calendar repository unavailable');
    return { plans: await this.repository.listAssistantPlanProgress(user.id) };
  }

  @Public()
  @Post('event-check-conflict')
  async eventConflict(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: Record<string, unknown>) {
    const { user } = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'event.check_conflict');
    return this.calendar.checkConflict(user, body);
  }

  @Public()
  @Post('event-create')
  async eventCreate(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: ToolDelegatedEventDto) {
    const owner = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'event.create');
    if (body.confirmed !== true) throw new BadRequestException('Calendar confirmation required');
    if (!body.confirmation_proof) throw new BadRequestException('Calendar confirmation proof required');
    await this.assertCalendarWriteAllowed('create', owner.payload.sub, query.device_id, body);
    const secret = this.config.get<string>('toolExecution.voiceMutationSecret');
    if (!secret || !query.device_id) throw new ForbiddenException('Calendar voice write proof is not configured');
    const operation = { userId: owner.payload.sub, deviceId: query.device_id, sessionId: query.session_id,
      operation: 'create' as const, operationId: body.idempotency_key, title: body.title,
      startsAt: body.starts_at, endsAt: body.ends_at, timezone: body.timezone ?? 'UTC' };
    verifyConfirmationProof(body.confirmation_proof, operation, secret);
    if (!this.repository) throw new ServiceUnavailableException('Calendar repository unavailable');
    return this.repository.executeVoiceMutation(operation);
  }

  @Public()
  @Post('event-update')
  async eventUpdate(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: ToolDelegatedEventDto) {
    const owner = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'event.update');
    if (body.confirmed !== true) throw new BadRequestException('Calendar confirmation required');
    const secret = this.config.get<string>('toolExecution.voiceMutationSecret');
    if (!query.event_id) throw new BadRequestException('Event ID required');
    await this.assertCalendarWriteAllowed('update', owner.payload.sub, query.device_id, body, query.event_id);
    if (!secret || !query.device_id) throw new ForbiddenException('Calendar writes are disabled');
    const operation = { userId: owner.payload.sub, deviceId: query.device_id, sessionId: query.session_id, operation: 'update' as const, operationId: body.idempotency_key, eventId: query.event_id, title: body.title, startsAt: body.starts_at, endsAt: body.ends_at, timezone: body.timezone ?? 'UTC' };
    verifyConfirmationProof(body.confirmation_proof, operation, secret);
    if (!this.repository) throw new ServiceUnavailableException('Calendar repository unavailable');
    return this.repository.executeVoiceMutation(operation);
  }

  @Public()
  @Post('event-delete')
  async eventDelete(@Headers('authorization') authorization: string | undefined, @Headers('x-ai-tool-service') serviceToken: string | undefined, @Query() query: ToolDelegatedEventQueryDto, @Body() body: ToolDelegatedDeleteDto) {
    const owner = await this.authorize(authorization, serviceToken, query.session_id, query.device_id, 'event.delete');
    if (body.confirmed !== true) throw new BadRequestException('Calendar confirmation required');
    const secret = this.config.get<string>('toolExecution.voiceMutationSecret');
    await this.assertCalendarWriteAllowed('delete', owner.payload.sub, query.device_id, body, body.event_id);
    if (!secret || !query.device_id) throw new ForbiddenException('Calendar writes are disabled');
    const operation = { userId: owner.payload.sub, deviceId: query.device_id, sessionId: query.session_id, operation: 'delete' as const, operationId: body.idempotency_key, eventId: body.event_id };
    verifyConfirmationProof(body.confirmation_proof, operation, secret);
    if (!this.repository) throw new ServiceUnavailableException('Calendar repository unavailable');
    return this.repository.executeVoiceMutation(operation);
  }

  private async authorize(authorization: string | undefined, serviceToken: string | undefined, sessionId: string, deviceId: string | undefined, scope: string) {
    const expected = this.config.get<string>('toolExecution.serviceToken') ?? '';
    if (!expected || serviceToken !== expected) throw new UnauthorizedException('Tool service authentication required');
    const [scheme, token] = (authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Delegation required');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string; scope: string; sid: string; did?: string }>(token, { secret: this.config.getOrThrow<string>('auth.accessTokenSecret'), issuer: 'aiva-iot', audience: 'aiva-backend-tool-execution' });
      if (payload.typ !== 'tool_delegation' || payload.scope !== scope || payload.sid !== sessionId || !payload.sub) throw new Error();
      if (payload.did !== undefined && (!deviceId || payload.did !== deviceId)) throw new Error();
      if (payload.did !== undefined) await this.devices.getOwned(payload.sub, payload.did);
      const user = await this.users.getUserById(payload.sub); const role = await this.users.getUserRole(payload.sub);
      if (user.status !== 'active' || !user.email_verified_at) throw new Error();
      return { user: { id: user.id, email: user.email, display_name: user.display_name, role }, payload };
    } catch { throw new UnauthorizedException('Invalid or expired delegation'); }
  }

  private async assertCalendarWriteAllowed(operation: 'create'|'update'|'delete', userId: string,
    deviceId: string | undefined, body: Partial<ToolDelegatedEventDto>, eventId?: string) {
    if (this.config.get<boolean>('toolExecution.calendarWritesEnabled') === true) return;
    const test = this.config.get<any>('toolExecution.productionCalendarTest');
    const expiresAt = Date.parse(test?.expiresAt ?? '');
    if (!test?.enabled || this.config.get<string>('database.name') !== 'aiva_iot'
      || !Number.isFinite(expiresAt) || Date.now() >= expiresAt
      || userId !== test.userId || !deviceId || deviceId !== test.deviceId) {
      throw new ForbiddenException('Calendar writes are disabled');
    }
    if (operation === 'update') throw new ForbiddenException('Calendar test updates are disabled');
    if (operation === 'create') {
      if (body.title !== test.title || Date.parse(body.starts_at ?? '') !== Date.parse(test.startsAt)
        || Date.parse(body.ends_at ?? '') !== Date.parse(test.endsAt)
        || body.timezone !== test.timezone) {
        throw new ForbiddenException('Calendar test payload is outside the approved scope');
      }
      return;
    }
    if (!eventId || !this.repository) throw new ForbiddenException('Calendar test cleanup target is unavailable');
    const existing = await this.repository.findEvent(userId, eventId);
    if (!existing || existing.title !== test.title || existing.timezone !== test.timezone
      || existing.starts_at.getTime() !== Date.parse(test.startsAt)
      || existing.ends_at?.getTime() !== Date.parse(test.endsAt)) {
      throw new ForbiddenException('Calendar test cleanup target is outside the approved scope');
    }
  }
}
