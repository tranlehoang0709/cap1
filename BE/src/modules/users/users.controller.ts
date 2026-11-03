import { Controller, Delete, Get, Param, Patch, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from './users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePrivacyDto } from './dto/update-privacy.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Read own profile' })
  me(@CurrentUser() user: AuthenticatedUser) { return this.users.getUserById(user.id); }

  @Patch('me')
  @ApiOperation({ summary: 'Update own display name' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto.display_name);
  }

  @Get('me/privacy')
  @ApiOperation({ summary: 'Read own conversation history preference' })
  getPrivacy(@CurrentUser() user: AuthenticatedUser) { return this.users.getPrivacy(user.id); }

  @Patch('me/privacy')
  @ApiOperation({ summary: 'Update own conversation history preference' })
  updatePrivacy(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePrivacyDto) {
    return this.users.updatePrivacy(user.id, dto.save_history);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List users (Admin), paginated and searchable' })
  async list(@Query() query: ListUsersQueryDto) {
    const result = await this.users.listUsers(query.page, query.limit, query.search);
    return { ...result, page: query.page, limit: query.limit, total_pages: Math.ceil(result.total / query.limit) };
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Read a user (Admin)' })
  async get(@Param('id') id: string) {
    const user = await this.users.getUserById(id);
    return { ...user, role: await this.users.getUserRole(id) };
  }

  @Patch(':id/role')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Change a user role (Admin); last active Admin is protected' })
  changeRole(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.users.changeUserRole(actor.id, id, dto.role);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Change account status (Admin)' })
  changeStatus(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.users.changeAccountStatus(actor.id, id, dto.status);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-disable a user (Admin); records remain for audit and foreign-key integrity' })
  disable(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.changeAccountStatus(actor.id, id, 'disabled');
  }
}
