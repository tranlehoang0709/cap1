import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DevicePrincipal as DeviceIdentity } from '../../modules/devices/devices.types';

export const DevicePrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DeviceIdentity => context.switchToHttp().getRequest().device,
);
