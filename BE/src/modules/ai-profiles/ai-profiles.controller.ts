import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { InternalAIConfigGuard } from '../ai-providers/ai.guards';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { PersonalAssistantService } from '../personal-assistant/personal-assistant.service';

@Controller('internal/ai')
@Public()
@UseGuards(InternalAIConfigGuard)
export class InternalAIConfigController {
  constructor(private readonly ai: AiProvidersService, private readonly pa: PersonalAssistantService) {}
  @Post('resolve-config') @HttpCode(200)
  resolve(@Body() body: unknown, @Res({passthrough:true}) response: {setHeader(name:string,value:string):unknown}) {
    response.setHeader('Cache-Control','no-store');
    return this.ai.resolveAIConfiguration(body);
  }
  @Post('turns/start') @HttpCode(200)
  start(@Body() body: unknown) { return this.ai.startTurn(body); }
  @Post('turns/user-message') @HttpCode(200)
  userMessage(@Body() body: unknown) { return this.ai.recordUserMessage(body); }
  @Post('turns/assistant-message') @HttpCode(200)
  assistantMessage(@Body() body: unknown) { return this.ai.recordAssistantMessage(body); }
  @Post('turns/complete') @HttpCode(200)
  complete(@Body() body: unknown) { return this.ai.completeTurn(body); }
  @Post('memories/context') @HttpCode(200)
  async memoryContext(@Body() body: unknown) {
    const owner = await this.ai.verifyInternalUserDevice(body);
    const result = await this.pa.listMemories(owner.userId, { page: 1, limit: 100,
      category: 'personal_information' });
    return { userId: owner.userId, items: result.items.map(item => ({
      key: item.memory_key, value: item.memory_value, category: item.category,
      updatedAt: item.updated_at,
    })) };
  }
  @Post('memories/upsert') @HttpCode(200)
  async upsertMemories(@Body() body: unknown) {
    const owner = await this.ai.verifyInternalUserDevice(body);
    const input = body as { memories?: unknown };
    if (!Array.isArray(input.memories) || input.memories.length < 1 || input.memories.length > 8) {
      throw new BadRequestException('INVALID_MEMORY_INPUT');
    }
    const saved = [];
    for (const candidate of input.memories) {
      if (!candidate || typeof candidate !== 'object') {
        throw new BadRequestException('INVALID_MEMORY_INPUT');
      }
      const item = candidate as Record<string, unknown>;
      if (typeof item.key !== 'string' || !['profile.name','profile.residence'].includes(item.key)
          || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 200) {
        throw new BadRequestException('INVALID_MEMORY_INPUT');
      }
      saved.push(await this.pa.createMemory(owner.userId, {
        consent: true, memory_key: item.key, memory_value: item.value,
        category: 'personal_information', confidence: 1,
      }));
    }
    return { userId: owner.userId, saved: saved.map(item => ({
      key: item.memory_key, updatedAt: item.updated_at,
    })) };
  }
}

@Controller('user/ai/profile')
@Public()
@UseGuards(UserPairingGuard)
export class AiProfilesController {
  constructor(private readonly ai: AiProvidersService) {}
  @Get() get(@Req() req: AuthenticatedRequest) { return this.ai.getAIProfile(req.currentUser); }
  @Patch() update(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.ai.updateAIProfile(req.currentUser,body); }
}
