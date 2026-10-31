import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessRoleGuard } from '../auth/access-role.guard';
import { UsersService } from '../users/users.service';

@Injectable()
export class AdminDeviceGuard extends AccessRoleGuard {
  constructor(config: ConfigService, users: UsersService) { super(config, users, 'ADMIN'); }
}
