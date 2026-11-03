import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { InternalAIConfigGuard } from '../ai-providers/ai.guards';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AuthenticatedRequest } from '../auth/access-role.guard';

@Controller('internal/ai')
@Public()
@UseGuards(InternalAIConfigGuard)
export class InternalAIConfigController {
  constructor(private readonly ai: AiProvidersService) {}
  @Post('resolve-config') @HttpCode(200)
  resolve(@Body() body: unknown) { return this.ai.resolveAIConfiguration(body); }
}

@Controller('user/ai/profile')
@Public()
@UseGuards(UserPairingGuard)
export class AiProfilesController {
  constructor(private readonly ai: AiProvidersService) {}
  @Get() get(@Req() req: AuthenticatedRequest) { return this.ai.getAIProfile(req.currentUser); }
  @Patch() update(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.ai.updateAIProfile(req.currentUser,body); }
}
