export type UsersErrorCode =
  | 'USER_NOT_FOUND'
  | 'ROLE_DATA_INCONSISTENT'
  | 'ROLE_NOT_FOUND'
  | 'INVALID_ROLE'
  | 'INVALID_STATUS'
  | 'INVALID_INPUT'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DISABLED'
  | 'FORBIDDEN'
  | 'LAST_ADMIN_PROTECTED'
  | 'DATABASE_ERROR';

export class UsersServiceError extends Error {
  constructor(public readonly code: UsersErrorCode, message: string) {
    super(message);
    this.name = 'UsersServiceError';
  }
}
