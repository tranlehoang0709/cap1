import { SetMetadata } from '@nestjs/common';

export const IS_DEVICE_AUTH_KEY = 'isDeviceAuth';
export const DeviceAuth = () => SetMetadata(IS_DEVICE_AUTH_KEY, true);
