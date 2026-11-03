import { SetMetadata } from '@nestjs/common';
import { RoleCode } from '../../modules/users/users.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
