import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { QuotaSourceGuard } from './quota-source.guard';
import { QuotasService } from './quotas.service';

@Controller('internal/ai') @Public() @UseGuards(QuotaSourceGuard)
export class InternalQuotasController {
  constructor(private readonly quotas: QuotasService) {}
  @Post('authorize-request') @HttpCode(200)
  admit(@Body() body: unknown) {return this.quotas.authorizeAIRequest(body);}
  @Post('usage') @HttpCode(200)
  usage(@Body() body: unknown) {return this.quotas.recordAIUsage(body);}
}
@Controller('admin/ai') @Public() @UseGuards(AdminDeviceGuard)
export class AdminQuotasController {
  constructor(private readonly quotas: QuotasService) {}
  @Get('quotas/users/:userId/providers/:providerId')
  get(@Req() req: AuthenticatedRequest,@Param('userId') userId: string,@Param('providerId') providerId: string) {return this.quotas.getQuotaPolicy(req.currentUser,userId,providerId);}
  @Put('quotas/users/:userId/providers/:providerId')
  put(@Req() req: AuthenticatedRequest,@Param('userId') userId: string,@Param('providerId') providerId: string,@Body() body: unknown) {return this.quotas.updateQuotaPolicy(req.currentUser,userId,providerId,body);}
  @Get('usage') usage(@Req() req: AuthenticatedRequest,@Query() query: Record<string,unknown>) {return this.quotas.getUsageStatistics(req.currentUser,query);}
}
@Controller('user/ai/usage') @Public() @UseGuards(UserPairingGuard)
export class UserUsageController {
  constructor(private readonly quotas: QuotasService) {}
  @Get() usage(@Req() req: AuthenticatedRequest,@Query() query: Record<string,unknown>) {return this.quotas.getUsageStatistics(req.currentUser,query);}
}
