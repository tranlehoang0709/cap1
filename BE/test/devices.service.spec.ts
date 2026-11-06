import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { PairingService } from '../src/modules/pairing/pairing.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DeviceRecord, PairingRequestRecord } from '../src/modules/devices/devices.types';

const device = (status: DeviceRecord['lifecycle_status'] = 'available'): DeviceRecord => ({
  id: '10', device_uid: 'xiaozhi-01', display_name: 'Xiaozhi', hardware_model: 'esp32-s3', lifecycle_status: status,
  connection_status: 'offline', last_seen_at: null, battery_percent: null, wifi_rssi: null, created_at: new Date(), updated_at: new Date(),
});
const request = (): PairingRequestRecord => ({ id: '40', device_id: '10', user_id: '2', status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, created_at: new Date() });

describe('DevicesService', () => {
  let repository: Record<string, jest.Mock>;
  let service: DevicesService;
  let pairing: Record<string,jest.Mock>;
  beforeEach(() => {
    repository = {
      createDevice:jest.fn(),assertPairingReady:jest.fn(),assertCredentialReady:jest.fn(),
      transaction: jest.fn(async (work) => work(repository)), findById: jest.fn(), findOwnedByUser: jest.fn(), updateName: jest.fn(), audit: jest.fn(),
      createPairingCode: jest.fn(), consumePairingCode: jest.fn(), createPairingRequest: jest.fn(), findRequestById: jest.fn(),
      approveRequest: jest.fn(), rejectRequest: jest.fn(), issueCredential: jest.fn(), findCredential: jest.fn(), recordHeartbeat: jest.fn(),
    };
    pairing={createPairingRequest:jest.fn(),approvePairing:jest.fn(),rejectPairing:jest.fn()};
    service = new DevicesService(repository as unknown as DevicesRepository,pairing as unknown as PairingService);
  });

  it('registers device and code atomically, returns plaintext once and stores only SHA-256',async()=>{
    repository.createDevice.mockResolvedValue(device());
    const result=await service.register('xiaozhi-01','Xiaozhi','esp32-s3','1');
    expect(result).toMatchObject({id:'10',pairing_code:expect.any(String),expires_at:expect.any(Date)});
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    const hash=require('node:crypto').createHash('sha256').update(result.pairing_code).digest('hex');
    expect(repository.createPairingCode).toHaveBeenCalledWith('10',hash,result.expires_at);
    expect(JSON.stringify(repository.audit.mock.calls)).not.toContain(result.pairing_code);
  });
  it('rejects direct unlink before touching repository',async()=>{
    await expect(service.unlink('2','10')).rejects.toMatchObject({status:403});
    expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('registration cannot bypass the shared pairing readiness gate',async()=>{
    repository.createDevice.mockResolvedValue(device());
    repository.assertPairingReady.mockRejectedValue({status:409});
    await expect(service.register('xiaozhi-01')).rejects.toMatchObject({status:409});
    expect(repository.createPairingCode).not.toHaveBeenCalled();
  });
  it.each(['assigned','pending_approval','reset_pending','maintenance'] as const)('does not issue code in %s',async status=>{
    repository.findById.mockResolvedValue(device(status));
    await expect(service.createPairingCode('1','10',10)).rejects.toMatchObject({code:'DEVICE_NOT_AVAILABLE'});
    expect(repository.createPairingCode).not.toHaveBeenCalled();
  });
  it('rejects inconsistent available robot if owner, pending or reset gate blocks it',async()=>{
    repository.findById.mockResolvedValue(device());repository.assertPairingReady.mockRejectedValue({status:409});
    await expect(service.createPairingCode('1','10',10)).rejects.toMatchObject({status:409});
    expect(repository.createPairingCode).not.toHaveBeenCalled();
  });
  it('refuses credential issuance for a robot that is not ready',async()=>{
    repository.findById.mockResolvedValue(device());repository.assertCredentialReady.mockRejectedValue({status:403});
    await expect(service.issueCredential('1','10')).rejects.toMatchObject({status:403});
    expect(repository.issueCredential).not.toHaveBeenCalled();
  });
  it('issues a random one-time code and stores only its hash', async () => {
    repository.findById.mockResolvedValue(device());
    const result = await service.createPairingCode('1', '10', 10);
    expect(result.pairing_code).toHaveLength(32);
    expect(repository.createPairingCode).toHaveBeenCalledWith('10', expect.not.stringContaining(result.pairing_code), expect.any(Date));
    expect(repository.audit).toHaveBeenCalledWith('1', 'DEVICE_PAIRING_CODE_ISSUED', '10', expect.any(Object));
  });

  it('creates a pairing request only from an unconsumed valid code and available device', async () => {
    pairing.createPairingRequest.mockResolvedValue({id:'40'});
    repository.findRequestById.mockResolvedValue(request());
    repository.findById.mockResolvedValue(device());
    repository.createPairingRequest.mockResolvedValue(request());
    await expect(service.requestPairing('2', 'pairing-code-from-device')).resolves.toMatchObject({ id: '40', status: 'pending' });
    expect(pairing.createPairingRequest).toHaveBeenCalledWith({userId:'2',role:'USER'},{pairingCode:'pairing-code-from-device'});
  });

  it('rejects pairing attempts with an expired, invalid, or consumed code', async () => {
    pairing.createPairingRequest.mockRejectedValue({code:'PAIRING_CODE_INVALID'});
    await expect(service.requestPairing('2', 'used-code')).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    expect(repository.createPairingRequest).not.toHaveBeenCalled();
  });

  it('approves only a pending request for an available device', async () => {
    repository.findRequestById.mockResolvedValue({ ...request(), status: 'approved' });
    repository.findById.mockResolvedValue(device());
    await expect(service.reviewPairing('1', '40', true, 'approved')).resolves.toMatchObject({ status: 'approved' });
    expect(pairing.approvePairing).toHaveBeenCalledWith('40',{userId:'1',role:'ADMIN'},{reviewNote:'approved'});
  });

  it('verifies credentials through a stored hash and exposes no credential material', async () => {
    repository.findCredential.mockResolvedValue({ device_id: '10', device_uid: 'xiaozhi-01' });
    await expect(service.verifyCredential('secret-device-token')).resolves.toEqual({ deviceId: '10', deviceUid: 'xiaozhi-01' });
    expect(repository.findCredential).toHaveBeenCalledWith(expect.not.stringContaining('secret-device-token'));
  });
});
