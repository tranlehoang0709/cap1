import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('users')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a User account (Admin)' })
  @ApiCreatedResponse({ description: 'New account with USER role' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.display_name, dto.password, actor.id);
  }
}
