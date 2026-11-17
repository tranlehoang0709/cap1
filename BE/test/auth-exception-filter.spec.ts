import {
  ArgumentsHost, BadRequestException, Controller, Get, HttpException,
  INestApplication, Param, UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

const authCodes = ['OTP_EXPIRED', 'EMAIL_NOT_VERIFIED', 'ACCOUNT_SUSPENDED',
  'ACCOUNT_DISABLED', 'INVALID_CREDENTIALS'];

@Controller('auth-errors')
class ErrorFixtureController {
  @Get(':code')
  error(@Param('code') code: string): never {
    if (authCodes.includes(code)) {
      const payload = { code, message: 'Safe authentication message', stack: 'private-stack', SMTP_PASS: 'private-value' };
      throw code === 'OTP_EXPIRED' ? new BadRequestException(payload) : new UnauthorizedException(payload);
    }
    if (code === 'ordinary') throw new BadRequestException('Invalid request');
    if (code === 'validation') throw new BadRequestException(['email must be an email', 'code must be six digits']);
    if (code === 'string') throw new HttpException('Safe message', 409);
    if (code === 'internal-http') throw new HttpException({ code: 'INTERNAL_ERROR', message: 'private-secret', stack: 'private-stack' }, 500);
    throw new Error('private-secret');
  }
}

describe('Authentication errors through the real Nest HTTP exception filter', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ErrorFixtureController] }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it.each(authCodes)('preserves %s, status and the public response shape', async code => {
    const status = code === 'OTP_EXPIRED' ? 400 : 401;
    const response = await request(app.getHttpServer()).get(`/auth-errors/${code}`).expect(status);
    expect(response.body).toEqual({ statusCode: status, code, message: 'Safe authentication message',
      path: `/auth-errors/${code}`, timestamp: expect.any(String) });
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it.each([
    ['ordinary', 400, 'BAD_REQUEST', 'Invalid request'],
    ['validation', 400, 'BAD_REQUEST', 'email must be an email; code must be six digits'],
    ['string', 409, 'HTTP_ERROR', 'Safe message'],
    ['internal-http', 500, 'INTERNAL_ERROR', 'The request could not be completed'],
    ['unexpected', 500, 'INTERNAL_ERROR', 'An unexpected error occurred'],
  ])('handles ordinary HTTP errors safely: %s', async (path, status, code, message) => {
    const response = await request(app.getHttpServer()).get(`/auth-errors/${path}`).expect(Number(status));
    expect(response.body).toMatchObject({ statusCode: status, code, message });
    expect(JSON.stringify(response.body)).not.toMatch(/private-secret|private-stack|SMTP_PASS/);
    expect(Object.keys(response.body).sort()).toEqual(['statusCode', 'code', 'message', 'path', 'timestamp'].sort());
  });

  it.each([null, 123, {}, '', 'otp_expired', 'OTP EXPIRED', 'A'.repeat(65), 'SECRET\nDATA'])('rejects invalid business code %p', value => {
    let body: Record<string, unknown> | undefined;
    const host = { switchToHttp: () => ({ getRequest: () => ({ url: '/auth-errors' }),
      getResponse: () => ({ status: () => ({ json: (result: Record<string, unknown>) => { body = result; } }) }) }) };
    new ApiExceptionFilter().catch(new HttpException({ code: value, message: 'Safe message' }, 400), host as unknown as ArgumentsHost);
    expect(body?.code).toBe('HTTP_ERROR');
    expect(body?.statusCode).toBe(400);
  });
});
