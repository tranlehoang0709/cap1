import { Pool, PoolConnection } from 'mysql2/promise';
import { PairingRepository, PairingTransaction } from '../src/modules/pairing/pairing.repository';
import { PairingListDto } from '../src/modules/pairing/dto/pairing.dto';

describe('PairingRepository SQL/transactions', ()=>{
  let connection: {execute:jest.Mock;query:jest.Mock;beginTransaction:jest.Mock;commit:jest.Mock;rollback:jest.Mock;release:jest.Mock};
  let pool: Pool;
  let tx: PairingTransaction;
  let repo: PairingRepository;
  beforeEach(()=>{
    connection={execute:jest.fn(),query:jest.fn(),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    pool={getConnection:jest.fn().mockResolvedValue(connection)} as unknown as Pool;
    repo=new PairingRepository(pool);tx=new PairingTransaction(pool,connection as unknown as PoolConnection);
  });
  it('commits on one connection and always releases', async ()=>{
    await expect(repo.withTransaction(async transaction=>{expect(transaction).toBeInstanceOf(PairingTransaction);return 'done';})).resolves.toBe('done');
    expect(connection.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();expect(connection.release).toHaveBeenCalledTimes(1);
  });
  it.each(['work','commit','rollback','begin'])('cleans up on %s failure', async stage=>{
    const error=new Error('failure');
    if(stage==='commit')connection.commit.mockRejectedValue(error);
    if(stage==='rollback')connection.rollback.mockRejectedValue(error);
    if(stage==='begin')connection.beginTransaction.mockRejectedValue(error);
    await expect(repo.withTransaction(async()=>{if(['work','rollback'].includes(stage))throw error;})).rejects.toThrow();
    expect(connection.release).toHaveBeenCalledTimes(1);
    if(stage!=='begin')expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
  it('locks device, current assignment, request and code; verifies code lifetime on the DB clock', async ()=>{
    connection.execute.mockResolvedValue([[]]);
    await tx.findDeviceById('42');await tx.getActiveAssignment('42');await tx.findRequest('10',true);await tx.lockCode('5');
    for(const [sql] of connection.execute.mock.calls)expect(sql).toContain('FOR UPDATE');
    expect(connection.execute.mock.calls[3][0]).toContain('expires_at > UTC_TIMESTAMP()');
    expect(connection.execute.mock.calls[3][0]).toContain('consumed_at IS NULL AND revoked_at IS NULL');
  });
  it('finds codes by bound unique hash without projecting the hash', async ()=>{
    connection.execute.mockResolvedValue([[]]);await tx.findCodeByHash('digest');
    const [sql,values]=connection.execute.mock.calls[0];expect(values).toEqual(['digest']);
    expect(sql).toContain('WHERE code_hash = ?');expect(sql.split('FROM')[0]).not.toContain('code_hash');
  });
  it('uses a bound User scope for count and page, stable pagination and public fields', async ()=>{
    connection.execute.mockResolvedValueOnce([[{total:1}]]).mockResolvedValueOnce([[{id:'10',deviceId:'42',userId:'7',
      pairingCodeId:'5',status:'pending',reviewNote:null,reviewedBy:null,reviewedAt:null,createdAt:null,code_hash:'secret'}]]);
    const result=await repo.list(PairingListDto.parse({page:'2',limit:'3',status:'pending'}),'7');
    expect(result.pagination).toEqual({page:2,limit:3,total:1});
    for(const [sql,values] of connection.execute.mock.calls){expect(sql).toContain('user_id = ? AND status = ?');expect(values).toEqual(['7','pending']);}
    expect(connection.execute.mock.calls[1][0]).toContain('ORDER BY id DESC LIMIT 3 OFFSET 3');
    expect(JSON.stringify(result)).not.toMatch(/pairingCodeId|code_hash|secret/);
    expect(result.items[0].status).toBe('PENDING');
  });
  it('writes assignment and open history on the same transaction connection', async ()=>{
    connection.execute.mockResolvedValue([{affectedRows:1}]);
    await tx.createAssignment({id:'10',deviceId:'42',userId:'7'} as never,'1');
    expect(connection.execute.mock.calls[0][0]).toContain('INSERT INTO device_assignments');
    expect(connection.execute.mock.calls[0][1]).toEqual(['42','7','10','1']);
    expect(connection.execute.mock.calls[1][0]).toContain('INSERT INTO device_assignment_history');
    expect(connection.execute.mock.calls[1][0]).toContain('SELECT device_id,user_id,pairing_request_id,assigned_at');
  });
  it('uses conditional writes for pending request and still-usable code', async ()=>{
    connection.execute.mockResolvedValue([{affectedRows:1}]);
    await tx.reviewRequest('10','approved','1',null);await tx.consumeCode('5');
    expect(connection.execute.mock.calls[0][0]).toContain("AND status = 'pending'");
    expect(connection.execute.mock.calls[1][0]).toContain('AND expires_at > UTC_TIMESTAMP()');
    connection.execute.mockResolvedValue([{affectedRows:0}]);
    await expect(tx.consumeCode('5')).rejects.toMatchObject({code:'PAIRING_CONFLICT'});
    await expect(tx.reviewRequest('10','approved','1',null)).rejects.toMatchObject({code:'PAIRING_CONFLICT'});
  });
  it('reuses audit repository on the transaction connection; never stores raw code', async ()=>{
    connection.execute.mockResolvedValue([{affectedRows:1}]);
    await tx.writePairingAudit('1',{id:'10',deviceId:'42',userId:'7'} as never,'approved','OK');
    expect(connection.execute.mock.calls[0][0]).toContain('INSERT INTO audit_logs');
    expect(connection.execute.mock.calls[0][1]).toEqual(['1','DEVICE_PAIRING_APPROVED','DEVICE_PAIRING_REQUEST','10',
      JSON.stringify({deviceId:'42',userId:'7',reviewNote:'OK'})]);
  });
  it('reads inserted ID as CHAR rather than unsafe JavaScript numeric insertId', async ()=>{
    connection.execute.mockResolvedValueOnce([{insertId:9007199254740992}]).mockResolvedValueOnce([[{id:'9007199254740993'}]]);
    await expect(tx.createRequest('42','7','5')).resolves.toBe('9007199254740993');
  });

  describe('reset confirmation gate',()=>{
    const revokedAt=new Date('2026-10-29T00:00:00Z');
    const acknowledgedAt=new Date('2026-10-29T01:00:00Z');
    const fresh=new Date('2026-10-29T02:00:00Z');
    function arrange(blocked:unknown[],operations:unknown[],histories:unknown[],jobs:unknown[]){
      connection.execute.mockResolvedValueOnce([blocked]).mockResolvedValueOnce([operations])
        .mockResolvedValueOnce([histories]).mockResolvedValueOnce([jobs]);
    }
    it('permits a new device without unlink/history/reset',async()=>{
      arrange([],[],[],[]);await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(true);
    });
    it('blocks incomplete/revoked/unconfirmed unlink operations',async()=>{
      connection.execute.mockResolvedValueOnce([[{id:'1'}]]);
      await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(false);
    });
    it('permits a completed unlink with matching acknowledged reset and fresh code',async()=>{
      arrange([],[{id:'3',historyId:'20',revokedAt}],[{id:'20',unlinkedAt:revokedAt}],[{unlinkId:'3',status:'acknowledged',acknowledgedAt}]);
      await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(true);
    });
    it.each([
      {unlinkId:'2',status:'acknowledged',acknowledgedAt},
      {unlinkId:'3',status:'pending',acknowledgedAt:null},
      {unlinkId:'3',status:'sent',acknowledgedAt:null},
      {unlinkId:'3',status:'failed',acknowledgedAt:null},
      {unlinkId:'3',status:'acknowledged',acknowledgedAt:null},
      {unlinkId:'3',status:'acknowledged',acknowledgedAt:new Date('2026-10-28T00:00:00Z')},
    ])('blocks mismatched/pending/invalid reset %j',async job=>{
      arrange([],[{id:'3',historyId:'20',revokedAt}],[{id:'20',unlinkedAt:revokedAt}],[job]);
      await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(false);
    });
    it('blocks code issued before reset acknowledgement',async()=>{
      arrange([],[{id:'3',historyId:'20',revokedAt}],[{id:'20',unlinkedAt:revokedAt}],[{unlinkId:'3',status:'acknowledged',acknowledgedAt}]);
      await expect(tx.resetAllowsPairing('42',revokedAt)).resolves.toBe(false);
    });
    it('blocks a completed unlink that belongs to another history row',async()=>{
      arrange([],[{id:'3',historyId:'19',revokedAt}],[{id:'20',unlinkedAt:revokedAt}],
        [{unlinkId:'3',status:'acknowledged',acknowledgedAt}]);
      await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(false);
    });
    it.each([[{unlinkedAt:null}],[{id:'20',unlinkedAt:revokedAt}]])('blocks orphan history %j',async history=>{
      arrange([],[],[history],[]);await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(false);
    });
    it('blocks orphan reset jobs without an unlink',async()=>{
      arrange([],[],[],[{unlinkId:'3',status:'acknowledged',acknowledgedAt}]);
      await expect(tx.resetAllowsPairing('42',fresh)).resolves.toBe(false);
    });
  });
});
