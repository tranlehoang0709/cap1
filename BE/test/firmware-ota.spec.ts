import { Pool } from 'mysql2/promise';
import { FirmwareOtaRepository } from '../src/modules/firmware-ota/firmware-ota.repository';

describe('Firmware UTC timestamp regression', () => {
  it('supplies required created_at explicitly in UTC', async () => {
    const execute = jest.fn().mockResolvedValue([{ insertId: 12 }]);
    const repository = new FirmwareOtaRepository({ execute } as unknown as Pool);
    const input = { hardware_model: 'test', version: 'test-version', file_uri: 'https://example.invalid/test.bin', checksum_sha256: 'a'.repeat(64) };
    await expect(repository.create(input, '1')).resolves.toBe('12');
    const [sql, values] = execute.mock.calls[0];
    expect(sql).toContain('uploaded_by,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP())');
    expect(values).toEqual([input.hardware_model, input.version, input.file_uri, input.checksum_sha256, '1']);
  });

  it('releases in UTC without changing an existing release timestamp', async () => {
    const execute = jest.fn().mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: 12 }]]);
    const repository = new FirmwareOtaRepository({ execute } as unknown as Pool);
    await expect(repository.release('12')).resolves.toEqual({ id: 12 });
    expect(execute.mock.calls[0]).toEqual(['UPDATE firmware_versions SET released_at=COALESCE(released_at,UTC_TIMESTAMP()) WHERE id=?', ['12']]);
  });
});
