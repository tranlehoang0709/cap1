export type DevicesErrorCode =
  | 'DEVICE_NOT_FOUND' | 'DEVICE_NOT_OWNED' | 'DEVICE_ALREADY_ASSIGNED' | 'DEVICE_NOT_AVAILABLE'
  | 'PAIRING_CODE_INVALID' | 'PAIRING_REQUEST_NOT_FOUND' | 'PAIRING_REQUEST_INVALID_STATE'
  | 'CREDENTIAL_INVALID' | 'INVALID_INPUT' | 'DATABASE_ERROR';

export class DevicesServiceError extends Error {
  constructor(public readonly code: DevicesErrorCode, message: string) {
    super(message);
    this.name = 'DevicesServiceError';
  }
}
