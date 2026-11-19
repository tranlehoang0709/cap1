import { Pool, PoolConnection } from 'mysql2/promise';
import { OwnershipTransaction } from '../src/modules/devices/ownership.repository';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';

describe('Audit SQL regressions (unit checks; real MySQL coverage is in mysql.integration.ts)', () => {
  it('binds exactly the six telemetry parameters including recorded_at', async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const tx = new OwnershipTransaction({} as Pool, { execute } as unknown as PoolConnection);
    const time = new Date('2026-11-17T00:00:00Z');
    await tx.recordHeartbeat('42', time, { wifiRssi: -60, freeHeapBytes: '1234', batteryPercent: 80, payload: null });
    const [sql, values] = execute.mock.calls[1];
    expect((sql.match(/\?/g) ?? []).length).toBe(values.length);
    expect(values).toEqual(['42', -60, '1234', 80, null, time]);
  });

  it('checks ownership using the actual device_assignments primary key', async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ device_id: '42' }]]).mockResolvedValueOnce([[]]);
    const repo = new PersonalAssistantRepository({ execute } as unknown as Pool);
    expect(await repo.verifyUserDeviceOwnership('7', '42')).toBe(true);
    expect(await repo.verifyUserDeviceOwnership('8', '42')).toBe(false);
    expect(execute.mock.calls[0]).toEqual(['SELECT device_id FROM device_assignments WHERE user_id = ? AND device_id = ? LIMIT 1', ['7', '42']]);
  });
});
