import { Body,Controller,Get,HttpCode,Patch,Post,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { InternalAIConfigGuard } from '../ai-providers/ai.guards';

@Controller('user/ai/profile')
@UseGuards(UserPairingGuard)
export class AiProfilesController {
  constructor(private readonly ai:AiProvidersService){}
  @Get()
  read(@Req() req:AuthenticatedRequest){return this.ai.getAIProfile(req.currentUser);}
  @Patch()
  update(@Req() req:AuthenticatedRequest,@Body() body:unknown){return this.ai.updateAIProfile(req.currentUser,body);}
}
@Controller('internal/ai')
@UseGuards(InternalAIConfigGuard)
export class InternalAIConfigController {
  constructor(private readonly ai:AiProvidersService){}
  @Post('resolve-config')
  @HttpCode(200)
  resolve(@Body() body:unknown){return this.ai.resolveAIConfiguration(body);}
}
