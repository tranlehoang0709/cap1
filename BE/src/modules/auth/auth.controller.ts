import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from './auth.types';
import { DeviceToolDelegationDto } from './dto/device-tool-delegation.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ToolDelegationDto } from './dto/tool-delegation.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create a User account' })
  @ApiCreatedResponse({ description: 'Account created with the USER role' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.display_name, dto.password);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a newly registered email address with a 6-digit OTP (TTL 5 minutes)' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.email, dto.code);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: ResendVerificationDto) { return this.auth.resendVerification(dto.email); }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.email); }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.email, dto.code, dto.new_password); }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in and issue access/refresh tokens' })
  @ApiOkResponse({ description: 'Bearer token pair; refresh token is single-use and rotated' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the supplied refresh token' })
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshDto) {
    return this.auth.logout(user.id, dto.refresh_token);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated account' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('tool-delegations')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Issue a short-lived scoped PA tool delegation' })
  issueToolDelegation(@CurrentUser() user: AuthenticatedUser, @Body() dto: ToolDelegationDto) {
    return this.auth.issueToolDelegation(user.id, dto.scope, dto.session_id, dto.device_id);
  }

  @Post('tool-delegations/device')
  @HttpCode(HttpStatus.OK)
  @Public()
  issueDeviceToolDelegation(@Headers('x-ai-device-service') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: DeviceToolDelegationDto) {
    const expected = this.config.get<string>('AI_DEVICE_SERVICE_TOKEN') ?? '';
    const bearer = authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!expected || (serviceToken !== expected && bearer !== expected)) throw new UnauthorizedException('Device service authentication required');
    return this.auth.issueDeviceToolDelegation({ deviceUid: dto.device_uid, credential: dto.credential,
      sessionId: dto.session_id, proofNonce: dto.proof_nonce, scope: dto.scope });
  }

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password and revoke all refresh sessions' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.current_password, dto.new_password);
  }
}
