import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { DevicesController } from '../src/modules/devices/devices.controller';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { AdminDeviceGuard } from '../src/modules/devices/admin-device.guard';
import { UsersService } from '../src/modules/users/users.service';
import { DeviceQueryDto } from '../src/modules/devices/dto/device-query.dto';

const secret = 'test-only-access-key-with-at-least-32-bytes';
const repository = { list: jest.fn(), findById: jest.fn() };
const users = { canLogin: jest.fn(), getUserRole: jest.fn() };
const config = new ConfigService({ ADMIN_ACCESS_JWT_SECRET: secret,
  ADMIN_ACCESS_JWT_ISSUER: 'aiva-test', ADMIN_ACCESS_JWT_AUDIENCE: 'admin' });
@Module({ controllers: [DevicesController], providers: [DevicesService, AdminDeviceGuard,
  { provide: DevicesRepository, useValue: repository }, { provide: UsersService, useValue: users },
  { provide: ConfigService, useValue: config }] })
class TestModule {}

function token(claims: Record<string, unknown> = {}, key = secret, alg = 'HS256') {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '1', exp: Math.floor(Date.now()/1000)+60,
    iss: 'aiva-test', aud: 'admin', ...claims })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`;
}

describe('Admin devices HTTP', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    users.canLogin.mockResolvedValue({ allowed: true }); users.getUserRole.mockResolvedValue('ADMIN');
    repository.list.mockImplementation(async (q: DeviceQueryDto) => ({ items: [], pagination: {page:q.page,limit:q.limit,total:0} }));
    repository.findById.mockResolvedValue(null);
  });
  const get = (path: string, jwt: string | null = token()) => fetch(base + path,
    { headers: jwt === null ? {} : { authorization: `Bearer ${jwt}` } });

  it('lists devices with bounded defaults and empty results', async () => {
    const response = await get('/admin/devices');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], pagination: {page:1,limit:20,total:0} });
  });
  it('passes pagination and combined filters', async () => {
    expect((await get('/admin/devices?page=2&limit=5&search=robot&connectionStatus=online')).status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith({ page:2,limit:5,search:'robot',connectionStatus:'online' });
  });
  it('returns a populated list without reshaping the repository contract', async () => {
    const result = {items:[{id:'1',deviceUid:'robot-1',displayName:null,
      lifecycleStatus:'available',connectionStatus:'offline',lastSeenAt:null,owner:null}],
      pagination:{page:1,limit:20,total:1}};
    repository.list.mockResolvedValue(result);
    const response = await get('/admin/devices');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
  it.each(['page=0','page=-1','page=1.5','page=1000001','limit=101','limit=abc',
    'page=1&page=2','search=x&search=y',`search=${'a'.repeat(129)}`,'search=%00',
    'connectionStatus=ONLINE','connectionStatus=x%27'])('rejects invalid query %s', async (query) => {
    expect((await get(`/admin/devices?${query}`)).status).toBe(400);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it.each(['0','-1','abc','1.5','9223372036854775808'])('rejects invalid ID %s', async id => {
    expect((await get(`/admin/devices/${id}`)).status).toBe(400);
    expect(repository.findById).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing device', async () => {
    expect((await get('/admin/devices/42')).status).toBe(404);
  });
  it.each([null, {id:'7',displayName:'Owner'}])('returns existing device with owner %j', async owner => {
    repository.findById.mockResolvedValue({ id:'42',deviceUid:'robot',hardwareModel:'esp32',owner,currentAssignment:null });
    const response = await get('/admin/devices/42');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({id:'42',owner});
  });
  it.each([null,'invalid',token({},'wrong-key'),token({exp:1}),token({aud:'wrong'}),
    token({iss:'wrong'}),token({nbf:9999999999}),token({},secret,'none')])('denies missing or invalid token', async jwt => {
    expect((await get('/admin/devices',jwt)).status).toBe(401);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('denies User even when token claims Admin', async () => {
    users.getUserRole.mockResolvedValue('USER');
    expect((await get('/admin/devices',token({role:'ADMIN'}))).status).toBe(403);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('protects detail with the same authentication and authorization', async () => {
    expect((await get('/admin/devices/42',null)).status).toBe(401);
    users.getUserRole.mockResolvedValue('USER');
    expect((await get('/admin/devices/42')).status).toBe(403);
    expect(repository.findById).not.toHaveBeenCalled();
  });
  it('denies inactive/unverified accounts and absent JWT configuration', async () => {
    users.canLogin.mockResolvedValue({allowed:false});
    expect((await get('/admin/devices')).status).toBe(403);
    const spy = jest.spyOn(config,'get').mockReturnValue(undefined);
    expect((await get('/admin/devices')).status).toBe(401);
    spy.mockRestore();
  });
  it('does not leak SQL errors', async () => {
    repository.list.mockRejectedValue(new Error('secret SQL details'));
    const response = await get('/admin/devices');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});

describe('DevicesRepository SQL and projection', () => {
  const row = {id:'1',deviceUid:'robot',displayName:null,lifecycleStatus:'available',
    connectionStatus:'offline',lastSeenAt:null,ownerId:null,ownerDisplayName:null,
    assignmentDeviceId:null,hardwareModel:null,currentFirmwareId:null,createdAt:null,updatedAt:null,
    password_hash:'never-return',credential_hash:'never-return',secret_ciphertext:'never-return'};
  let execute: jest.Mock;
  let connection: {execute:jest.Mock;query:jest.Mock;commit:jest.Mock;rollback:jest.Mock;release:jest.Mock};
  let repo: DevicesRepository;
  beforeEach(() => {
    execute = jest.fn();
    connection = {execute,query:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    repo = new DevicesRepository({execute,getConnection:jest.fn().mockResolvedValue(connection)} as never);
  });
  it('uses stable sorting, escaped bound search, PK joins and read-only snapshot', async () => {
    execute.mockResolvedValueOnce([[{total:1}]]).mockResolvedValueOnce([[row]]);
    const result = await repo.list(DeviceQueryDto.parse({page:'2',limit:'3',search:'a%_!',connectionStatus:'offline'}));
    expect(result.pagination).toEqual({page:2,limit:3,total:1});
    expect(execute.mock.calls[1][0]).toContain('ORDER BY d.id ASC');
    expect(execute.mock.calls[1][0]).toContain('LIMIT 3 OFFSET 3');
    expect(execute.mock.calls[1][0]).toContain('a.device_id = d.id');
    expect(execute.mock.calls[1][1]).toEqual(['offline','%a!%!_!!%','%a!%!_!!%']);
    expect(connection.query).toHaveBeenCalledWith('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/password|credential|secret/);
    for (const [sql] of execute.mock.calls) expect(sql).toMatch(/^SELECT /);
  });
  it.each([null,'7'])('projects optional owner and current assignment %s', async ownerId => {
    execute.mockResolvedValue([[{...row,ownerId,ownerDisplayName:'Owner',assignmentDeviceId:ownerId === null ? null:'1',
      assignmentUserId:ownerId,pairingRequestId:'9',assignedBy:'2',assignedAt:null}]]);
    const result = await repo.findById('1');
    expect(result?.owner).toEqual(ownerId === null ? null : {id:'7',displayName:'Owner'});
    expect(result?.currentAssignment).toEqual(ownerId === null ? null : {
      deviceId:'1',userId:'7',pairingRequestId:'9',assignedBy:'2',assignedAt:null});
    expect(JSON.stringify(result)).not.toMatch(/password|credential|secret/);
    expect(execute.mock.calls[0][1]).toEqual(['1']);
  });
  it('releases the connection and rolls back on query failure', async () => {
    execute.mockRejectedValue(new Error('DB unavailable'));
    await expect(repo.list(new DeviceQueryDto())).rejects.toThrow('DB unavailable');
    expect(connection.rollback).toHaveBeenCalled(); expect(connection.release).toHaveBeenCalled();
  });
});
