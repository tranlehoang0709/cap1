import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { AiServerServiceGuard } from '../../common/guards/ai-server-service.guard';
import { InternalApiService } from './internal-api.service';

class SessionDto { @IsString() conversation_id!: string; @IsOptional() @IsString() device_id?: string; @IsOptional() @IsString() ai_server_instance_id?: string; @IsOptional() @IsIn(['active', 'completed', 'failed', 'closed']) status?: string; }
class SessionUpdateDto { @IsIn(['active', 'completed', 'failed', 'closed']) status!: string; @IsOptional() @IsString() error_code?: string; }
class UsageDto { @IsString() user_id!: string; @IsOptional() @IsString() conversation_id?: string; @IsOptional() @IsString() ai_session_id?: string; @IsString() provider_id!: string; @IsOptional() @IsString() model_id?: string; @IsOptional() @IsString() credential_id?: string; @IsString() request_kind!: string; @IsOptional() @IsInt() @Min(0) input_tokens?: number; @IsOptional() @IsInt() @Min(0) output_tokens?: number; @IsOptional() @IsInt() @Min(0) duration_ms?: number; @IsOptional() @IsIn(['success', 'error', 'cancelled']) status?: string; @IsOptional() @IsString() occurred_at?: string; }

@ApiTags('internal')
@ApiBearerAuth()
@Controller('internal')
@UseGuards(AiServerServiceGuard)
export class InternalApiController {
  constructor(private readonly service: InternalApiService) {}
  @Public() @Get('health') health() { return { status: 'ok', service: 'aiva-backend' }; }
  @Post('ai/sessions') createSession(@Body() dto: SessionDto) { return this.service.createSession(dto as unknown as Record<string, unknown>); }
  @Patch('ai/sessions/:id') updateSession(@Param('id') id: string, @Body() dto: SessionUpdateDto) { return this.service.updateSession(id, dto as unknown as Record<string, unknown>); }
  @Post('usage') usage(@Body() dto: UsageDto) { return this.service.usage(dto as unknown as Record<string, unknown>); }
}
