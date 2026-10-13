import { Pool, PoolConnection } from 'mysql2/promise';
import { UsersRepository } from '../src/modules/users/users.repository';

describe('UsersRepository transaction handling', () => {
  it('commits successful work and releases the connection', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection) };
    const repository = new UsersRepository(pool as unknown as Pool);

    await expect(repository.withTransaction(async () => 'done')).resolves.toBe('done');

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back failed work and releases the connection', async () => {
    const failure = new Error('audit insert failed');
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection) };
    const repository = new UsersRepository(pool as unknown as Pool);

    await expect(repository.withTransaction(async () => { throw failure; })).rejects.toBe(failure);

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('reports both work and rollback errors when rollback fails', async () => {
    const failure = new Error('audit insert failed');
    const rollbackFailure = new Error('rollback failed');
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockRejectedValue(rollbackFailure),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection) };
    const repository = new UsersRepository(pool as unknown as Pool);

    await expect(repository.withTransaction(async () => { throw failure; })).rejects.toBeInstanceOf(AggregateError);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
