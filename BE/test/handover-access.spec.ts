import { Pool } from 'mysql2/promise';
import { AiRepository } from '../src/modules/ai/ai.repository';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { OwnershipTransaction } from '../src/modules/devices/ownership.repository';
import { visibleConversation, ownedConversationHistory } from '../src/modules/devices/assignment-access';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';

describe('Handover SQL access rules (mock connection, no live database)',()=>{
  let c:any; let pool:any;
  beforeEach(()=>{
    c={query:jest.fn(),execute:jest.fn(async()=>[[]]),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
    pool={getConnection:jest.fn(async()=>c)};
  });
  it.each(['read','write'])('legacy profile %s refuses a user with no approved robot before accessing profile',async action=>{
    const repo=new AiRepository(pool as Pool);
    await expect(action==='read'?repo.profile('7'):repo.upsertProfile('7',{} as any)).rejects.toMatchObject({status:403});
    expect(c.execute.mock.calls.some(([sql]:[string])=>sql.includes('ai_profiles'))).toBe(false);
    expect(c.rollback).toHaveBeenCalled();expect(c.release).toHaveBeenCalled();
  });
  it.each(['read','write'])('new profile %s uses the approved-robot gate',async action=>{
    const tx={requireApprovedRobot:jest.fn().mockRejectedValue(Object.assign(new Error('denied'),{getStatus:()=>403})),profile:jest.fn(),saveProfile:jest.fn()};
    const ai=new AiProvidersService({transaction:async(work:any)=>work(tx)} as any,{} as any,{} as any);
    await expect(action==='read'?ai.getAIProfile({userId:'7',role:'USER'}):ai.updateAIProfile({userId:'7',role:'USER'},{assistantName:'AIVA'})).rejects.toBeDefined();
    expect(tx.requireApprovedRobot).toHaveBeenCalledWith('7');expect(tx.profile).not.toHaveBeenCalled();expect(tx.saveProfile).not.toHaveBeenCalled();
  });
  it('history and live AI context both require the exact current assignment',async()=>{
    expect(visibleConversation).toContain('h.id=c.assignment_history_id');
    expect(visibleConversation).toContain('h.unlinked_at IS NULL');
    expect(visibleConversation).toContain('a.assigned_at=h.assigned_at');
    expect(visibleConversation).toContain('p.status=\'approved\'');
    expect(visibleConversation).toContain("c.device_id IS NULL AND LOWER(c.channel)='web'");
    c.execute.mockImplementation(async(sql:string)=>sql.includes('COUNT(*)')?[[{total:0}]]:[[]]);
    const repo=new AiRepository(pool);
    expect(await repo.conversation('20','7')).toBeNull();
    expect(await repo.conversations('7',1,20)).toEqual({items:[],total:0});
    expect(await repo.deleteConversation('20','7')).toBe(false);
    const sql=c.execute.mock.calls.filter(([sql]:[string])=>sql.includes('conversations c'));
    expect(sql).toHaveLength(4);
    expect(ownedConversationHistory).toContain('h.id=c.assignment_history_id');
    expect(ownedConversationHistory).toContain('h.user_id=c.user_id');
    expect(ownedConversationHistory).toBe(visibleConversation);
    for(const [query,values] of sql){
      expect(query).toContain(ownedConversationHistory);expect(query).toContain('c.user_id=?');expect(values).toContain('7');
    }
  });
  it('current history lookup rejects ambiguity and requires matching request, time, owner and device',async()=>{
    c.execute.mockResolvedValue([[{id:'10'},{id:'11'}]]);
    const tx=new OwnershipTransaction(pool,c);
    expect(await tx.activeHistoryId('7','42')).toBeNull();
    const [sql,values]=c.execute.mock.calls[0];
    expect(sql).toContain('a.pairing_request_id=h.pairing_request_id');
    expect(sql).toContain('a.assigned_at=h.assigned_at');expect(sql).toContain('h.unlinked_at IS NULL');
    expect(values).toEqual(['42','7']);
  });
  it('both former and replacement Users are denied old history when there is no current assignment (mock SQL)',async()=>{
    c.execute.mockImplementation(async(sql:string)=>{
      if(sql.includes('FROM device_assignments'))return [[]];
      if(sql.includes('FROM conversations c')){
        expect(sql).toContain(visibleConversation);
        return sql.includes('COUNT(*)')?[[{total:0}]]:[[]];
      }
      throw new Error('Messages must not be read for inaccessible history');
    });
    const repo=new AiRepository(pool);
    for(const userId of ['7','8']){
      expect(await repo.conversations(userId,1,100)).toEqual({total:0,items:[]});
      expect(await repo.conversation('20',userId)).toBeNull();
    }
  });
  it('replacement code revokes previous unconsumed codes before insert',async()=>{
    const repo=new DevicesRepository(pool,c);
    await repo.createPairingCode('42','hash',new Date());
    const [revoke,insert]=c.execute.mock.calls;
    expect(revoke[0]).toContain('consumed_at IS NULL AND revoked_at IS NULL');
    expect(insert[0]).toContain('INSERT INTO device_pairing_codes');
  });
  it.each(['owner','pending','reset'])('code issuance fails closed on inconsistent available device with %s',async blocker=>{
    c.execute.mockImplementation(async(sql:string)=>{
      if(sql.includes('UTC_TIMESTAMP() AS now'))return [[{now:new Date()}]];
      if(sql.includes('FROM device_assignments'))return [blocker==='owner'?[{deviceId:'42',userId:'7'}]:[]];
      if(sql.includes('FROM device_pairing_requests'))return [blocker==='pending'?[{id:'9'}]:[]];
      if(sql.includes('FROM device_unlink_operations'))return [[{id:'10'}]];
      return [[]];
    });
    await expect(new DevicesRepository(pool,c).assertPairingReady('42')).rejects.toMatchObject({status:409});
  });
  it.each(['unassigned','reset_pending','unacknowledged'])('credential issuance refuses %s device',async status=>{
    c.execute.mockImplementation(async(sql:string)=>{
      if(sql.includes('FROM device_assignments WHERE'))return [status==='unassigned'?[]:[{deviceId:'42',userId:'7'}]];
      return [[]];
    });
    await expect(new DevicesRepository(pool,c).assertCredentialReady('42')).rejects.toMatchObject({status:403});
    expect(c.execute.mock.calls.some(([sql]:[string])=>sql.includes('INSERT INTO device_credentials'))).toBe(false);
  });
});

describe('Additive handover migration (schema simulation only)',()=>{
  const {migrateRobotHandover}=require('../src/database/migrations/20261105_robot_handover.cjs');
  function connection(existing=false,badType=false){return {query:jest.fn(),execute:jest.fn(async(sql:string)=>{
    if(sql.includes('information_schema.TABLES'))return [[{name:'conversations',engine:'InnoDB'},{name:'device_assignment_history',engine:'InnoDB'}]];
    if(sql.includes('information_schema.COLUMNS'))return [[{tableName:'device_assignment_history',name:'id',type:'bigint',nullable:'NO'},
      ...(existing?[{tableName:'conversations',name:'assignment_history_id',type:badType?'varchar(32)':'bigint',nullable:'YES'}]:[])]];
    return [existing?[{name:'fk_conversations_assignment_history_id',target:'device_assignment_history',targetColumn:'id'}]:[]];
  })};}
  it('plans without mutation, applies only additive DDL, then is a no-op on migrated schema',async()=>{
    const c=connection();const plan=await migrateRobotHandover(c);expect(plan).toHaveLength(2);expect(c.query).not.toHaveBeenCalled();
    await migrateRobotHandover(c,{apply:true});expect(c.query).toHaveBeenCalledTimes(2);
    for(const sql of plan)expect(sql).toMatch(/^ALTER TABLE conversations ADD (COLUMN|CONSTRAINT)/);
    const done=connection(true);expect(await migrateRobotHandover(done,{apply:true})).toEqual([]);expect(done.query).not.toHaveBeenCalled();
  });
  it('refuses incompatible existing schema without executing ALTER',async()=>{
    const c=connection(true,true);await expect(migrateRobotHandover(c,{apply:true})).rejects.toThrow('incompatible');expect(c.query).not.toHaveBeenCalled();
  });
});
