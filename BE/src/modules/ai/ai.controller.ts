import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { AiService } from './ai.service';
import { ChatDto, KeyDto, PageDto, ProfileDto, ProviderDto, QuotaDto } from './dto/ai.dto';
@ApiTags('ai') @ApiBearerAuth() @Controller()
export class AiController {constructor(private readonly ai:AiService){}
 @Get('ai/providers') @ApiOperation({summary:'List AI providers'}) providers(){return this.ai.providers();}
 @Get('ai/providers/:id/models') @ApiOperation({summary:'List enabled models for a provider'}) models(@Param('id')id:string){return this.ai.models(id);}
 @Patch('admin/ai/providers/:id') @Roles('ADMIN') @ApiOperation({summary:'Enable or disable AI provider'}) provider(@Param('id')id:string,@Body()dto:ProviderDto){return this.ai.setProvider(id,dto.is_enabled,dto.health_status??null);}
 @Get('ai/profile') profile(@CurrentUser()u:AuthenticatedUser){return this.ai.profile(u.id);}
 @Patch('ai/profile') updateProfile(@CurrentUser()u:AuthenticatedUser,@Body()dto:ProfileDto){return this.ai.updateProfile(u.id,{assistant_name:dto.assistant_name??null,system_prompt:dto.system_prompt??null,language_code:dto.language_code??null,voice_code:dto.voice_code??null,preferred_provider_id:dto.preferred_provider_id??null,preferred_llm_model_id:dto.preferred_llm_model_id??null});}
 @Get('api-keys') keys(@CurrentUser()u:AuthenticatedUser){return this.ai.keys(u.id);}
 @Post('api-keys') key(@CurrentUser()u:AuthenticatedUser,@Body()dto:KeyDto){return this.ai.addKey(u.id,dto.provider_id,dto.label,dto.secret);}
 @Delete('api-keys/:id') @HttpCode(HttpStatus.OK) revoke(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.ai.revokeKey(u.id,id);}
 @Get('admin/api-keys/system') @Roles('ADMIN') systemKeys(){return this.ai.systemKeys();}
 @Post('admin/api-keys/system') @Roles('ADMIN') systemKey(@Body()dto:KeyDto){return this.ai.addSystemKey(dto.provider_id,dto.label,dto.secret);}
 @Delete('admin/api-keys/system/:id') @Roles('ADMIN') @HttpCode(HttpStatus.OK) revokeSystemKey(@Param('id')id:string){return this.ai.revokeSystemKey(id);}
 @Post('web-chat/messages') chat(@CurrentUser()u:AuthenticatedUser,@Body()dto:ChatDto){return this.ai.chat(u.id,dto.content,dto.provider_id);}
 @Get('conversations') async conversations(@CurrentUser()u:AuthenticatedUser,@Query()q:PageDto){const r=await this.ai.conversations(u.id,q.page,q.limit);return {...r,page:q.page,limit:q.limit,total_pages:Math.ceil(r.total/q.limit)};}
 @Get('conversations/:id') conversation(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.ai.conversation(u.id,id);}
 @Delete('conversations/:id') @HttpCode(HttpStatus.OK) delete(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.ai.deleteConversation(u.id,id);}
 @Get('quotas') quotas(@CurrentUser()u:AuthenticatedUser){return this.ai.quotas(u.id);}
 @Get('usage') usage(@CurrentUser()u:AuthenticatedUser,@Query('from')from?:string,@Query('to')to?:string){const end=to?new Date(to):new Date();const start=from?new Date(from):new Date(end.getFullYear(),end.getMonth(),1);if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>=end)throw new BadRequestException('Invalid usage date range');return this.ai.usage(u.id,start,end);}
 @Get('admin/quotas') @Roles('ADMIN') adminQuotas(){return this.ai.quotas(null);}
 @Post('admin/quotas') @Roles('ADMIN') setQuota(@Body()dto:QuotaDto){return this.ai.setQuota(dto.user_id??null,dto.provider_id??null,dto.requests_per_minute??null,dto.requests_per_day??null,dto.tokens_per_month??null);}
 @Delete('admin/quotas/:id') @Roles('ADMIN') @HttpCode(HttpStatus.OK) deleteQuota(@Param('id')id:string){return this.ai.deactivateQuota(id);}
}
