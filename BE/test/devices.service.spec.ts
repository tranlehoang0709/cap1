import { DevicesRepository } from '../src/modules/devices/devices.repository';
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
  beforeEach(() => {
    repository = {
      transaction: jest.fn(async (work) => work(repository)), findById: jest.fn(), findOwnedByUser: jest.fn(), updateName: jest.fn(), audit: jest.fn(),
      createPairingCode: jest.fn(), consumePairingCode: jest.fn(), createPairingRequest: jest.fn(), findRequestById: jest.fn(),
      approveRequest: jest.fn(), rejectRequest: jest.fn(), issueCredential: jest.fn(), findCredential: jest.fn(), recordHeartbeat: jest.fn(),
    };
    service = new DevicesService(repository as unknown as DevicesRepository);
  });

  it('issues a random one-time code and stores only its hash', async () => {
    repository.findById.mockResolvedValue(device());
    const result = await service.createPairingCode('1', '10', 10);
    expect(result.pairing_code).toHaveLength(32);
    expect(repository.createPairingCode).toHaveBeenCalledWith('10', expect.not.stringContaining(result.pairing_code), expect.any(Date));
    expect(repository.audit).toHaveBeenCalledWith('1', 'DEVICE_PAIRING_CODE_ISSUED', '10', expect.any(Object));
  });

  it('creates a pairing request only from an unconsumed valid code and available device', async () => {
    repository.consumePairingCode.mockResolvedValue({ id: '20', device_id: '10' });
    repository.findById.mockResolvedValue(device());
    repository.createPairingRequest.mockResolvedValue(request());
    await expect(service.requestPairing('2', 'pairing-code-from-device')).resolves.toMatchObject({ id: '40', status: 'pending' });
    expect(repository.createPairingRequest).toHaveBeenCalledWith('10', '2', '20');
  });

  it('rejects pairing attempts with an expired, invalid, or consumed code', async () => {
    repository.consumePairingCode.mockResolvedValue(null);
    await expect(service.requestPairing('2', 'used-code')).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    expect(repository.createPairingRequest).not.toHaveBeenCalled();
  });

  it('approves only a pending request for an available device', async () => {
    repository.findRequestById.mockResolvedValueOnce(request()).mockResolvedValueOnce({ ...request(), status: 'approved' });
    repository.findById.mockResolvedValue(device());
    await expect(service.reviewPairing('1', '40', true, 'approved')).resolves.toMatchObject({ status: 'approved' });
    expect(repository.approveRequest).toHaveBeenCalledWith(expect.objectContaining({ id: '40' }), '1', 'approved');
  });

  it('verifies credentials through a stored hash and exposes no credential material', async () => {
    repository.findCredential.mockResolvedValue({ device_id: '10', device_uid: 'xiaozhi-01' });
    await expect(service.verifyCredential('secret-device-token')).resolves.toEqual({ deviceId: '10', deviceUid: 'xiaozhi-01' });
    expect(repository.findCredential).toHaveBeenCalledWith(expect.not.stringContaining('secret-device-token'));
  });
});
