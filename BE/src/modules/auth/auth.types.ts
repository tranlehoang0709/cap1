import { RoleCode } from '../users/users.types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  display_name: string;
  role: RoleCode;
}

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
