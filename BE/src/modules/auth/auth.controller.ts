import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  @ApiOperation({ summary: 'Verify a newly registered email address (token TTL 15 minutes)' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
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
  resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.new_password); }

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

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password and revoke all refresh sessions' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.current_password, dto.new_password);
  }
}
