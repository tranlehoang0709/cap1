import { ToolExecutionController } from '../src/modules/calendar/tool-execution.controller';
import { AuthService } from '../src/modules/auth/auth.service';

describe('device-bound schedule delegation', () => {
  const users = { getUserById: jest.fn().mockResolvedValue({ id: '7', email: 'u@example.test', display_name: 'User', status: 'active', email_verified_at: new Date() }), getUserRole: jest.fn().mockResolvedValue('USER') } as any;
  const calendar = { listEvents: jest.fn().mockResolvedValue({ items: [] }) } as any;
  const devices = { getOwned: jest.fn().mockResolvedValue({ id: '9' }) } as any;
  const config = { get: jest.fn().mockReturnValue('service-token'), getOrThrow: jest.fn().mockReturnValue('signing-secret') } as any;
  const jwt = { verifyAsync: jest.fn() } as any;
  const controller = () => new ToolExecutionController(jwt, config, users, calendar, devices);
  const request = (query: any = { session_id: 's', device_id: '9' }) => controller().schedule('Bearer token', 'service-token', query);

  beforeEach(() => { jest.clearAllMocks(); jwt.verifyAsync.mockResolvedValue({ sub: '7', typ: 'tool_delegation', scope: 'schedule.query', sid: 's', did: '9' }); });

  it('allows the bound user, device and session and rechecks live ownership', async () => {
    await expect(request()).resolves.toEqual({ items: [] });
    expect(devices.getOwned).toHaveBeenCalledWith('7', '9');
    expect(calendar.listEvents).toHaveBeenCalled();
  });

  it.each([
    ['wrong device', { session_id: 's', device_id: '10' }],
    ['missing device', { session_id: 's' }],
    ['wrong session', { session_id: 'other', device_id: '9' }],
  ])('denies %s', async (_label, query) => {
    await expect(request(query)).rejects.toMatchObject({ status: 401 });
    expect(calendar.listEvents).not.toHaveBeenCalled();
  });

  it('denies a revoked or reassigned device at execution time', async () => {
    devices.getOwned.mockRejectedValueOnce(new Error('not owned'));
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(calendar.listEvents).not.toHaveBeenCalled();
  });

  it('denies a delegation without the required scope', async () => {
    jwt.verifyAsync.mockResolvedValueOnce({ sub: '7', typ: 'tool_delegation', scope: 'event.create', sid: 's', did: '9' });
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(calendar.listEvents).not.toHaveBeenCalled();
  });

  it('denies expired, malformed, or cross-user delegations', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(request()).rejects.toMatchObject({ status: 401 });
    jwt.verifyAsync.mockResolvedValueOnce({ sub: '8', typ: 'tool_delegation', scope: 'schedule.query', sid: 's', did: '9' });
    devices.getOwned.mockRejectedValueOnce(new Error('not owned by user 8'));
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(calendar.listEvents).not.toHaveBeenCalled();
  });

  it('issues a device delegation only from a verified proof and consumes the nonce once', async () => {
    const service = Object.create(AuthService.prototype) as any;
    service.config = { get: jest.fn().mockReturnValue('true') };
    service.devices = {
      verifyCredential: jest.fn().mockResolvedValue({ deviceId: '9', deviceUid: 'robot-9' }),
      ownerForDevice: jest.fn().mockResolvedValue('7'),
    };
    service.consumedDeviceProofNonces = new Set<string>();
    service.issueToolDelegation = jest.fn().mockResolvedValue({ delegation_token: 'opaque' });
    const input = { deviceUid: 'robot-9', credential: 'D'.repeat(43), sessionId: 's', proofNonce: 'nonce-123456789012', scope: 'schedule.query' as const };
    await expect(service.issueDeviceToolDelegation(input)).resolves.toEqual({ delegation_token: 'opaque' });
    await expect(service.issueDeviceToolDelegation(input)).rejects.toMatchObject({ status: 401 });
    expect(service.issueToolDelegation).toHaveBeenCalledWith('7', 'schedule.query', 's', '9');
  });

  it('rejects a proof whose UID does not match the credential-bound device', async () => {
    const service = Object.create(AuthService.prototype) as any;
    service.config = { get: jest.fn().mockReturnValue('true') };
    service.devices = { verifyCredential: jest.fn().mockResolvedValue({ deviceId: '9', deviceUid: 'other-uid' }) };
    service.consumedDeviceProofNonces = new Set<string>();
    await expect(service.issueDeviceToolDelegation({ deviceUid: 'robot-9', credential: 'D'.repeat(43), sessionId: 's', proofNonce: 'nonce-223456789012', scope: 'schedule.query' })).rejects.toMatchObject({ status: 401 });
  });
});
