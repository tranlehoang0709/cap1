import { BadRequestException } from '@nestjs/common';

function bodyObject(body: unknown): Record<string,unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('JSON object required');
  return body as Record<string,unknown>;
}

export function renameInput(body: unknown): string {
  const input=bodyObject(body);
  if (Object.keys(input).some(key=>key!=='displayName') || typeof input.displayName!=='string') {
    throw new BadRequestException('Only displayName is accepted');
  }
  const name=input.displayName.trim();
  if (!name || [...name].length>120 || /[\u0000-\u001f\u007f]/.test(input.displayName)) {
    throw new BadRequestException('displayName must contain 1–120 characters without controls');
  }
  return name;
}

export function authorizationInput(body: unknown): {deviceUid:string;credential:string} {
  if (!body || typeof body!=='object' || Array.isArray(body)) {
    throw new BadRequestException({allowed:false,reason:'INVALID_INPUT',message:'Invalid device authorization input'});
  }
  const input=bodyObject(body);
  if (Object.keys(input).some(key=>!['deviceUid','credential'].includes(key))
    || typeof input.deviceUid!=='string' || !input.deviceUid || [...input.deviceUid].length>128
    || /[\s\u0000-\u001f\u007f]/.test(input.deviceUid)
    || typeof input.credential!=='string' || !/^[A-Za-z0-9_-]{43,128}$/.test(input.credential)) {
    throw new BadRequestException({allowed:false,reason:'INVALID_INPUT',message:'Invalid device authorization input'});
  }
  return {deviceUid:input.deviceUid,credential:input.credential};
}
