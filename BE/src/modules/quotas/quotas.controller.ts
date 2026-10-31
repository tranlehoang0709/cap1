import { Body,Controller,Get,HttpCode,Param,Post,Put,Query,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { QuotasService } from './quotas.service';
import { QuotaSourceGuard } from './quota-source.guard';

@Controller('admin/ai') @UseGuards(AdminDeviceGuard)
export class AdminQuotasController {
  constructor(private readonly quotas:QuotasService){}
  @Get('quotas/users/:userId/providers/:providerId')
  read(@Req() req:AuthenticatedRequest,@Param('userId') userId:string,@Param('providerId') providerId:string){return this.quotas.getQuotaPolicy(req.currentUser,userId,providerId);}
  @Put('quotas/users/:userId/providers/:providerId')
  update(@Req() req:AuthenticatedRequest,@Param('userId') userId:string,@Param('providerId') providerId:string,@Body() body:unknown){return this.quotas.updateQuotaPolicy(req.currentUser,userId,providerId,body);}
  @Get('usage') statistics(@Req() req:AuthenticatedRequest,@Query() query:Record<string,unknown>){return this.quotas.getUsageStatistics(req.currentUser,query);}
}
@Controller('user/ai/usage') @UseGuards(UserPairingGuard)
export class UserUsageController {
  constructor(private readonly quotas:QuotasService){}
  @Get() statistics(@Req() req:AuthenticatedRequest,@Query() query:Record<string,unknown>){return this.quotas.getUsageStatistics(req.currentUser,query);}
}
@Controller('internal/ai') @UseGuards(QuotaSourceGuard)
export class InternalQuotasController {
  constructor(private readonly quotas:QuotasService){}
  @Post('authorize-request') @HttpCode(200) authorize(@Body() body:unknown){return this.quotas.authorizeAIRequest(body);}
  @Post('usage') @HttpCode(200) report(@Body() body:unknown){return this.quotas.recordAIUsage(body);}
}
