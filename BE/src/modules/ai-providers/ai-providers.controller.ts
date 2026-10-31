import { Body,Controller,Get,Param,Patch,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { AIActorGuard } from './ai.guards';
import { AiProvidersService } from './ai-providers.service';

@Controller('ai/providers')
@UseGuards(AIActorGuard)
export class AiProvidersController {
  constructor(private readonly ai:AiProvidersService){}
  @Get()
  list(@Req() req:AuthenticatedRequest){return this.ai.listAvailableProviders(req.currentUser);}
}
@Controller('admin/ai/providers')
@UseGuards(AdminDeviceGuard)
export class AdminProvidersController {
  constructor(private readonly ai:AiProvidersService){}
  @Patch(':id')
  update(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() body:unknown){return this.ai.updateProviderSettings(req.currentUser,id,body);}
}
