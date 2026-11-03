import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_DEVICE_AUTH_KEY } from '../decorators/device-auth.decorator';
import { DevicesService } from '../../modules/devices/devices.service';
import { DevicePrincipal } from '../../modules/devices/devices.types';

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly devices: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(IS_DEVICE_AUTH_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; device?: DevicePrincipal }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Device credential required');
    try {
      request.device = await this.devices.verifyCredential(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or revoked device credential');
    }
  }
}
