import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AiProvidersService } from './ai-providers.service';
import { AIActorGuard } from './ai.guards';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { AuthenticatedRequest } from '../auth/access-role.guard';

// Standalone legacy controllers are exported for their existing tests. The live
// module keeps existing /ai/providers and /admin/ai/providers/:id controllers.
@Controller('ai/providers') @UseGuards(AIActorGuard)
export class AiProvidersController {
  constructor(private readonly ai: AiProvidersService) {}
  @Get() list(@Req() req: AuthenticatedRequest) {return this.ai.listAvailableProviders(req.currentUser);}
}
@Controller('admin/ai/providers') @UseGuards(AdminDeviceGuard)
export class AdminProvidersController {
  constructor(private readonly ai: AiProvidersService) {}
  @Patch(':id') update(@Req() req: AuthenticatedRequest,@Param('id') id: string,@Body() body: unknown) {return this.ai.updateProviderSettings(req.currentUser,id,body);}
}
