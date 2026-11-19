import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PersonalAssistantService } from '../src/modules/personal-assistant/personal-assistant.service';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';

function setup() {
  const repo = {
    withTransaction: jest.fn(async (work) => work({})),
    insertPlan: jest.fn(async () => '11'),
    insertTask: jest.fn(async () => '22'),
    findPlanByIdRaw: jest.fn(async () => ({ id: '11', user_id: '2' })),
    buildPlanRecord: jest.fn(async () => ({ id: '11' })),
    findMemoryByIdRaw: jest.fn(),
    deleteMemoryById: jest.fn(),
    updateMemoryFields: jest.fn(),
  };
  return { repo, service: new PersonalAssistantService(repo as unknown as PersonalAssistantRepository) };
}

describe('PA-04 and PA-06 isolated service logic, without database writes', () => {
  it('PA-04 rejects missing or false consent before opening a transaction', async () => {
    const { repo, service } = setup();
    await expect(service.createMemory('2', { memory_key: 'key', memory_value: 'value', consent: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });
  it('PA-04 rejects updates and deletion for another owner', async () => {
    const { repo, service } = setup();
    repo.findMemoryByIdRaw.mockResolvedValue({ id: '1', user_id: '3' });
    await expect(service.updateMemory('2', '1', { consent: true, memory_value: 'changed' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteMemory('2', '1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateMemoryFields).not.toHaveBeenCalled();
    expect(repo.deleteMemoryById).not.toHaveBeenCalled();
  });
  it('PA-04 reports a deleted memory as 404', async () => {
    const { repo, service } = setup();
    repo.findMemoryByIdRaw.mockResolvedValue(null);
    await expect(service.getMemory('2', '1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('PA-06 rejects unconfirmed explicit steps before database writes', async () => {
    const { repo, service } = setup();
    await expect(service.createPlan('2', { title: 'Plan', goal: 'Goal', total_sessions: 1, sessions: [{ title: 'Step' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertPlan).not.toHaveBeenCalled();
  });
  it('PA-06 rejects whitespace-only step titles independently of the frontend', async () => {
    const { repo, service } = setup();
    await expect(service.createPlan('2', { title: 'Plan', goal: 'Goal', total_sessions: 1, sessions: [{ title: '   ' }], confirmed: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertTask).not.toHaveBeenCalled();
  });
});

describe('PA-06 repository progress rules with fixed isolated rows', () => {
  const row = { id: '11', user_id: '2', total_sessions: 3, title: 'Plan', status: 'active' };
  async function progress(statuses: string[]) {
    const tasks = statuses.map((status, index) => ({ id: String(index + 1), session_number: index + 1, status, progress_percent: status === 'completed' ? 100 : 40 }));
    const pool = { execute: jest.fn(async () => [tasks]) };
    return new PersonalAssistantRepository(pool as never).buildPlanRecord(row as never);
  }
  it('counts confirmed completion, preserves partial status and bounds percentages', async () => {
    expect((await progress(['pending', 'partial', 'in_progress'])).progress_percent).toBe(0);
    expect((await progress(['completed', 'pending', 'partial'])).progress_percent).toBe(33);
    expect((await progress(['completed', 'completed', 'completed'])).progress_percent).toBe(100);
    const empty = await progress([]);
    expect(empty.progress_percent).toBe(0);
    expect(Number.isFinite(empty.progress_percent)).toBe(true);
  });
});

describe('PA-06 deleted explicit steps', () => {
  it('recalculates the denominator for a fully materialized plan after a step is deleted', async () => {
    const all = [
      { id: '1', session_number: 1, status: 'completed', deleted_at: null },
      { id: '2', session_number: 2, status: 'pending', deleted_at: '2026-11-17' },
      { id: '3', session_number: 3, status: 'completed', deleted_at: null },
    ];
    const pool = { execute: jest.fn(async (sql: string) => [sql.includes('deleted_at IS NULL') ? all.filter(row => !row.deleted_at) : all]) };
    const result = await new PersonalAssistantRepository(pool as never).buildPlanRecord({ id: '11', user_id: '2', total_sessions: 3, status: 'active' } as never);
    expect(result.total_sessions).toBe(2);
    expect(result.progress_percent).toBe(100);
  });
});

describe('PA-06 dynamic and legacy plan totals', () => {
  async function record(total: number, tasks: Record<string, unknown>[]) {
    const pool = { execute: jest.fn(async () => [tasks]) };
    return new PersonalAssistantRepository(pool as never).buildPlanRecord({ id: '11', user_id: '2', total_sessions: total } as never);
  }
  it('includes an added step in the denominator without duplicate completion keys', async () => {
    const result = await record(2, [
      { id: '1', session_number: 1, status: 'completed' },
      { id: '2', session_number: 2, status: 'completed' },
      { id: '3', session_number: null, status: 'pending' },
    ]);
    expect(result.total_sessions).toBe(3);
    expect(result.progress_percent).toBe(67);
  });
  it('returns finite zero progress when all explicit steps are deleted', async () => {
    const result = await record(1, [{ id: '1', session_number: 1, status: 'completed', deleted_at: '2026-11-17' }]);
    expect(result.total_sessions).toBe(0);
    expect(result.progress_percent).toBe(0);
    expect(result.remaining_sessions).toBe(0);
    expect(result.sessions).toHaveLength(0);
  });
  it('retains declared totals for legacy virtual sessions', async () => {
    const result = await record(10, [{ id: '1', session_number: 1, status: 'completed' }]);
    expect(result.total_sessions).toBe(10);
    expect(result.progress_percent).toBe(10);
  });
});

describe('PA-06 invalid and stale requests', () => {
  it('rejects null steps with 400 instead of a runtime error', async () => {
    const { service, repo } = setup();
    await expect(service.createPlan('2', { title: 'Plan', total_sessions: 1, sessions: null } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });
  it('does not recreate a deleted step after a stale completion request', async () => {
    const { repo } = setup();
    const withTaskLookup = { ...repo, findTaskByIdRaw: jest.fn(async () => ({ id: '1', plan_id: '11', user_id: '2', deleted_at: '2026-11-17' })) };
    const service = new PersonalAssistantService(withTaskLookup as unknown as PersonalAssistantRepository);
    await expect(service.completePlanSession('2', '11', '1', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.insertTask).not.toHaveBeenCalled();
  });
});

describe('PA-06 atomic creation', () => {
  it('rolls back a partially inserted plan when a step insert fails', async () => {
    let insertedTasks = 0;
    const connection = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      execute: jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO personal_plans')) return [{ insertId: 11 }];
        if (sql.includes('INSERT INTO personal_tasks')) {
          insertedTasks++;
          if (insertedTasks === 2) throw new Error('isolated driver failure');
          return [{ insertId: 22 }];
        }
        if (sql.includes('FROM personal_tasks t')) return [[{ id: '22', user_id: '2', plan_id: '11', title: 'A', status: 'pending', priority: 'MEDIUM', progress_percent: 0 }]];
        throw new Error('Unexpected SQL in isolated test');
      }),
    };
    const pool = { getConnection: jest.fn(async () => connection) };
    const service = new PersonalAssistantService(new PersonalAssistantRepository(pool as never));
    await expect(service.createPlan('2', { title: 'Plan', goal: 'Goal', confirmed: true, total_sessions: 2, sessions: [{ title: 'A' }, { title: 'B' }] })).rejects.toThrow('isolated driver failure');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});

describe('PA-04 concurrent edits', () => {
  it('rejects a stale revision instead of overwriting a newer edit', async () => {
    const { repo, service } = setup();
    repo.findMemoryByIdRaw.mockResolvedValue({ id: '1', user_id: '2', memory_key: 'work', memory_value: 'newer edit', category: null, confidence: null, revision: 'b'.repeat(64) });
    await expect(service.updateMemory('2', '1', { consent: true, memory_value: 'stale edit', expected_revision: 'a'.repeat(64) } as never)).rejects.toMatchObject({ status: 409 });
    expect(repo.updateMemoryFields).not.toHaveBeenCalled();
  });
});
