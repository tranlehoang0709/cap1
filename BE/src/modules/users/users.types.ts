export type UserId = string | number;

export type AccountStatus = 'active' | 'suspended' | 'disabled';

export type RoleCode = 'ADMIN' | 'USER';

export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  status: AccountStatus;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithCredential extends PublicUser {
  password_hash: string;
}

export interface RoleRecord {
  id: number;
  code: RoleCode;
  name: string;
}

export interface CanLoginResult {
  allowed: boolean;
  reason: string | null;
}

export interface ChangeRoleResult {
  user_id: string;
  previous_role: RoleCode;
  current_role: RoleCode;
}

export interface ChangeStatusResult {
  user_id: string;
  previous_status: AccountStatus;
  current_status: AccountStatus;
  sessions_revoked: number;
  updated_at: Date;
}

export type AuditMetadata = Record<string, string | number | boolean | null>;
