import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { UsersServiceError } from '../../modules/users/users.errors';
import { DevicesServiceError } from '../../modules/devices/devices.errors';
import { AiServiceError } from '../../modules/ai/ai.errors';

const USER_ERROR_STATUS: Record<string, number> = {
  USER_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  INVALID_ROLE: 400,
  INVALID_STATUS: 400,
  ROLE_NOT_FOUND: 500,
  ROLE_DATA_INCONSISTENT: 409,
  LAST_ADMIN_PROTECTED: 409,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ url: string }>();
    const response = http.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    if (exception instanceof UsersServiceError) {
      status = USER_ERROR_STATUS[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      code = exception.code;
      message = status < 500 ? exception.message : 'The request could not be completed';
    } else if (exception instanceof DevicesServiceError) {
      const statuses: Record<string, number> = {
        DEVICE_NOT_FOUND: 404, DEVICE_NOT_OWNED: 403, DEVICE_ALREADY_ASSIGNED: 409, DEVICE_NOT_AVAILABLE: 409,
        PAIRING_CODE_INVALID: 400, PAIRING_REQUEST_NOT_FOUND: 404, PAIRING_REQUEST_INVALID_STATE: 409,
        CREDENTIAL_INVALID: 401, INVALID_INPUT: 400,
      };
      status = statuses[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      code = exception.code;
      message = status < 500 ? exception.message : 'The request could not be completed';
    } else if (exception instanceof AiServiceError) {
      const statuses: Record<string, number> = { PROVIDER_NOT_FOUND: 404, PROVIDER_UNAVAILABLE: 409, API_KEY_NOT_FOUND: 404, CONVERSATION_NOT_FOUND: 404, QUOTA_EXCEEDED: 429, QUOTA_NOT_FOUND: 404 };
      status = statuses[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR; code = exception.code;
      message = status < 500 ? exception.message : 'The request could not be completed';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = 'HTTP_ERROR';
      const payload = exception.getResponse();
      if (typeof payload === 'string') message = payload;
      else if (payload && typeof payload === 'object') {
        const body = payload as { message?: string | string[]; error?: unknown; code?: unknown };
        // Expose only a bounded machine-readable code, never arbitrary payload data.
        const validCode = (value: unknown): value is string =>
          typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
        const fallback = typeof body.error === 'string' ? body.error.toUpperCase().replaceAll(' ', '_') : undefined;
        code = validCode(body.code) ? body.code : validCode(fallback) ? fallback : 'HTTP_ERROR';
        message = Array.isArray(body.message) ? body.message.join('; ') : body.message ?? message;
      }
      if (status >= 500) message = 'The request could not be completed';
    }
    response.status(status).json({ statusCode: status, code, message, path: request.url, timestamp: new Date().toISOString() });
  }
}
