import { CalendarRepository } from '../src/modules/calendar/calendar.repository';

describe('CalendarRepository.claimDue', () => {
  function setup(rows: unknown[]) {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn()
        .mockResolvedValueOnce([rows])
        .mockResolvedValue([{}]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection) };
    return { repository: new CalendarRepository(pool as never), connection };
  }

  it('locks eligible rows and transitions each claimed delivery to queued atomically', async () => {
    const row = { id: 'r1', status: 'pending' };
    const { repository, connection } = setup([row]);

    await expect(repository.claimDue(10)).resolves.toEqual([row]);

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.execute.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(connection.execute.mock.calls[1][0]).toContain("status='queued'");
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two concurrent workers to claim a delivery', async () => {
    let state: 'pending' | 'queued' = 'pending';
    const makeConnection = () => ({
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          if (state !== 'pending') return [[]];
          state = 'queued';
          return [[{ id: 'r1', status: 'pending' }]];
        }
        return [{}];
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    });
    const first = makeConnection();
    const second = makeConnection();
    const pool = { getConnection: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
    const repository = new CalendarRepository(pool as never);

    const results = await Promise.all([repository.claimDue(10), repository.claimDue(10)]);

    expect(results).toEqual([[{ id: 'r1', status: 'pending' }], []]);
    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the connection when claiming fails', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockRejectedValue(new Error('deadlock')),
      commit: jest.fn(),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection) };
    const repository = new CalendarRepository(pool as never);

    await expect(repository.claimDue(10)).rejects.toThrow('deadlock');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
