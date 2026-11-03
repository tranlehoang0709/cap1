import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { DeviceAuthGuard } from '../src/common/guards/device-auth.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DevicesController } from '../src/modules/devices/devices.controller';
import { DevicesService } from '../src/modules/devices/devices.service';

const ACCESS_SECRET = 'phase-one-e2e-access-secret-with-more-than-32-characters';
const account = (id: string, role: 'ADMIN' | 'USER') => ({
  id, email: `${role.toLowerCase()}@example.test`, display_name: role,
  status: 'active' as const, email_verified_at: new Date(), last_login_at: null,
  created_at: new Date(), updated_at: new Date(), role,
});

describe('Auth and authorization API (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const authService = {
    register: jest.fn().mockResolvedValue({ id: '3', email: 'new@example.test', display_name: 'New User' }),
    login: jest.fn().mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 900 }),
    refresh: jest.fn().mockResolvedValue({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 900 }),
    logout: jest.fn().mockResolvedValue({ success: true }),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
  };
  const usersService = {
    getUserById: jest.fn(async (id: string) => account(id, id === '1' ? 'ADMIN' : 'USER')),
    getUserRole: jest.fn(async (id: string) => id === '1' ? 'ADMIN' : 'USER'),
    listUsers: jest.fn().mockResolvedValue({ items: [account('2', 'USER')], total: 1 }),
    updateProfile: jest.fn().mockResolvedValue(account('2', 'USER')),
    getPrivacy: jest.fn().mockResolvedValue({ save_history: true }),
    updatePrivacy: jest.fn().mockResolvedValue({ save_history: false }),
    changeUserRole: jest.fn().mockResolvedValue({ user_id: '2', previous_role: 'USER', current_role: 'ADMIN' }),
    changeAccountStatus: jest.fn().mockResolvedValue({ user_id: '2', previous_status: 'active', current_status: 'disabled', sessions_revoked: 1 }),
  };
  const devicesService = {
    register: jest.fn().mockResolvedValue({ id: '10', device_uid: 'xiaozhi-01' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    rename: jest.fn(), unlink: jest.fn(), requestPairing: jest.fn().mockResolvedValue({ id: '40', status: 'pending' }),
    listRequests: jest.fn().mockResolvedValue({ items: [], total: 0 }), createPairingCode: jest.fn(), issueCredential: jest.fn(),
    reviewPairing: jest.fn(), heartbeat: jest.fn(), verifyCredential: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController, UsersController, DevicesController],
      providers: [
        JwtAuthGuard, RolesGuard, DeviceAuthGuard,
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
        { provide: DevicesService, useValue: devicesService },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => key === 'auth.accessTokenSecret' ? ACCESS_SECRET : undefined } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalGuards(moduleRef.get(JwtAuthGuard), moduleRef.get(RolesGuard), moduleRef.get(DeviceAuthGuard));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => app.close());

  async function bearer(id: string): Promise<string> {
    return jwt.signAsync({ sub: id, typ: 'access' }, { secret: ACCESS_SECRET, issuer: 'aiva-iot', audience: 'aiva-api', expiresIn: 300 });
  }

  it('allows public registration and login requests', async () => {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email: 'new@example.test', display_name: 'New User', password: 'secure-pass-123' })
      .expect(201);
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email: 'user@example.test', password: 'secure-pass-123' })
      .expect(200)
      .expect(({ body }) => expect(body.token_type).toBe('Bearer'));
  });

  it('rejects unauthenticated access and malformed/unknown request fields', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email: 'new@example.test', display_name: 'New User', password: 'secure-pass-123', role: 'ADMIN' })
      .expect(400);
  });

  it('returns the authenticated identity and restricts Admin endpoints by database role', async () => {
    const userToken = await bearer('2');
    const adminToken = await bearer('1');
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${userToken}`)
      .expect(200).expect(({ body }) => expect(body.role).toBe('USER'));
    await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${adminToken}`)
      .expect(200).expect(({ body }) => expect(body.total).toBe(1));
    await request(app.getHttpServer()).patch('/users/2/role').set('Authorization', `Bearer ${userToken}`)
      .send({ role: 'ADMIN' }).expect(403);
    await request(app.getHttpServer()).patch('/users/2/role').set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' }).expect(200);
  });

  it('restricts device registration to Admin and permits a User pairing request', async () => {
    const userToken = await bearer('2');
    const adminToken = await bearer('1');
    await request(app.getHttpServer()).post('/devices/admin').set('Authorization', `Bearer ${userToken}`)
      .send({ device_uid: 'xiaozhi-01' }).expect(403);
    await request(app.getHttpServer()).post('/devices/admin').set('Authorization', `Bearer ${adminToken}`)
      .send({ device_uid: 'xiaozhi-01' }).expect(201);
    await request(app.getHttpServer()).post('/devices/pairing-requests').set('Authorization', `Bearer ${userToken}`)
      .send({ pairing_code: 'a'.repeat(32) }).expect(201);
    expect(devicesService.requestPairing).toHaveBeenCalledWith('2', 'a'.repeat(32));
  });
});
