import { Body,Controller,Delete,Get,Param,Patch,Post,Req,UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/access-role.guard';
import { UserPairingGuard } from '../pairing/user-pairing.guard';
import { AdminDeviceGuard } from '../devices/admin-device.guard';
import { AiProvidersService } from '../ai-providers/ai-providers.service';

@Controller('user/ai/credentials')
@UseGuards(UserPairingGuard)
export class ApiKeysController {
  constructor(private readonly ai:AiProvidersService){}
  @Get()
  list(@Req() r:AuthenticatedRequest){return this.ai.listCredentialMetadata(r.currentUser,'USER');}
  @Post()
  create(@Req() r:AuthenticatedRequest,@Body() b:unknown){return this.ai.saveApiCredential(r.currentUser,'USER',b);}
  @Patch(':id')
  replace(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:unknown){return this.ai.saveApiCredential(r.currentUser,'USER',b,id);}
  @Delete(':id')
  revoke(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.ai.revokeApiCredential(r.currentUser,'USER',id);}
}
@Controller('admin/ai/credentials')
@UseGuards(AdminDeviceGuard)
export class SystemApiKeysController {
  constructor(private readonly ai:AiProvidersService){}
  @Get()
  list(@Req() r:AuthenticatedRequest){return this.ai.listCredentialMetadata(r.currentUser,'SYSTEM');}
  @Post()
  create(@Req() r:AuthenticatedRequest,@Body() b:unknown){return this.ai.saveApiCredential(r.currentUser,'SYSTEM',b);}
  @Patch(':id')
  replace(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:unknown){return this.ai.saveApiCredential(r.currentUser,'SYSTEM',b,id);}
  @Delete(':id')
  revoke(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.ai.revokeApiCredential(r.currentUser,'SYSTEM',id);}
}
