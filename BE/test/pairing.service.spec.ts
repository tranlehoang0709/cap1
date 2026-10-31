import { createHash } from 'node:crypto';
import { PairingService } from '../src/modules/pairing/pairing.service';
import { PairingRepository, PairingTransaction } from '../src/modules/pairing/pairing.repository';
import { CurrentUser } from '../src/modules/auth/access-role.guard';

const user: CurrentUser = {userId:'7',role:'USER'};
const admin: CurrentUser = {userId:'1',role:'ADMIN'};
const request = (id='10',userId='7') => ({id,deviceId:'42',userId,pairingCodeId:'5',status:'pending',reviewNote:null});

describe('PairingService with transactional state model (no live fixtures)', () => {
  let service: PairingService;
  let tx: {[K in Exclude<keyof PairingTransaction,'users'>]: jest.Mock}
    & {users:{findByIdForUpdate:jest.Mock;findUserRoles:jest.Mock}};
  let repository: {withTransaction:jest.Mock;list:jest.Mock};
  let state: {requests:ReturnType<typeof request>[];code:{id:string;deviceId:string;usable:number;createdAt:Date};
    device:{id:string;lifecycleStatus:string};assignments:unknown[];histories:unknown[];audits:unknown[]};
  beforeEach(() => {
    state = {requests:[],code:{id:'5',deviceId:'42',usable:1,createdAt:new Date()},
      device:{id:'42',lifecycleStatus:'available'},assignments:[],histories:[],audits:[]};
    tx = {
      users: {
        findByIdForUpdate:jest.fn(async (id:string)=>({id,status:'active',email_verified_at:new Date()})),
        findUserRoles:jest.fn(async (id:string)=>[{code:id === '1' ? 'ADMIN':'USER'}]),
      },
      findCodeByHash:jest.fn(async ()=>({...state.code})), lockCode:jest.fn(async ()=>({...state.code})),
      findDeviceById:jest.fn(async ()=>({...state.device})),
      getActiveAssignment:jest.fn(async ()=>state.assignments[0] ?? null),
      resetAllowsPairing:jest.fn(async ()=>true),
      hasPendingRequest:jest.fn(async (_:string,id:string)=>state.requests.some(r=>r.userId===id&&r.status==='pending')),
      createRequest:jest.fn(async (_:string,id:string)=>{const r=request(String(state.requests.length+10),id);state.requests.push(r);return r.id;}),
      setLifecycle:jest.fn(async (_:string,status:string)=>{state.device.lifecycleStatus=status;}),
      findRequest:jest.fn(async (id:string)=>{const r=state.requests.find(r=>r.id===id);return r ? {...r}:null;}),
      consumeCode:jest.fn(async ()=>{state.code.usable=0;}),
      createAssignment:jest.fn(async (r:unknown)=>{state.assignments.push(r);state.histories.push(r);}),
      reviewRequest:jest.fn(async (id:string,status:string,_:string,note:string|null)=>{Object.assign(state.requests.find(r=>r.id===id)!,{status,reviewNote:note});}),
      writePairingAudit:jest.fn(async (...args:unknown[])=>{state.audits.push(args);}),
      writePairingRequestAudit:jest.fn(async (...args:unknown[])=>{state.audits.push(args);}),
      hasAnyPending:jest.fn(async ()=>state.requests.some(r=>r.status==='pending')),
    };
    // Model commit/rollback and serialization. SQL lock syntax/order is tested separately.
    let tail = Promise.resolve();
    repository = {
      withTransaction:jest.fn(async (work:(tx:PairingTransaction)=>Promise<unknown>)=>{
        const previous=tail; let release!:()=>void;
        tail=new Promise<void>(resolve=>{release=resolve;}); await previous;
        const snapshot=structuredClone(state);
        try {return await work(tx as unknown as PairingTransaction);}
        catch(error){state=snapshot;throw error;}
        finally{release();}
      }),
      list:jest.fn(async ()=>({items:[],pagination:{page:1,limit:20,total:0}})),
    };
    service=new PairingService(repository as unknown as PairingRepository);
  });
  it('creates PENDING with exact SHA-256 lookup; code remains unused', async ()=>{
    await expect(service.createPairingRequest(user,{pairingCode:'AbC123'})).resolves.toEqual({id:'10',deviceId:'42',status:'PENDING'});
    expect(tx.findCodeByHash).toHaveBeenCalledWith(createHash('sha256').update('AbC123').digest('hex'));
    expect(state.device.lifecycleStatus).toBe('pending_approval'); expect(state.code.usable).toBe(1);
    expect(state.assignments).toHaveLength(0);
    expect(tx.writePairingRequestAudit).toHaveBeenCalledWith('7','10','42');
    expect(tx.findDeviceById.mock.invocationCallOrder[0]).toBeLessThan(tx.lockCode.mock.invocationCallOrder[0]);
  });
  it.each(['', 'short', 'with space', 'x'.repeat(129), null, 123, ['abcdef']])('rejects malformed code %j', async pairingCode=>{
    await expect(service.createPairingRequest(user,{pairingCode})).rejects.toMatchObject({status:400});
    expect(repository.withTransaction).not.toHaveBeenCalled();
  });
  it.each(['expired','consumed','revoked'])('rejects unavailable %s code', async ()=>{
    state.code.usable=0;
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:400});
    expect(state.requests).toHaveLength(0);
  });
  it('rejects an unknown code and rechecks code after acquiring device lock', async ()=>{
    tx.findCodeByHash.mockResolvedValueOnce(null);
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:400});
    tx.lockCode.mockResolvedValueOnce({...state.code,usable:0});
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:400});
  });
  it('blocks duplicate requests, including concurrent submissions', async ()=>{
    const results=await Promise.allSettled([service.createPairingRequest(user,{pairingCode:'ABC123'}),
      service.createPairingRequest(user,{pairingCode:'ABC123'})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(state.requests).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
  });
  it('scopes User lists and allows Admin lists with bounded filters', async ()=>{
    await service.listPairingRequests(user,{status:'PENDING',page:'2',limit:'5'});
    expect(repository.list).toHaveBeenLastCalledWith({status:'pending',page:2,limit:5},'7');
    await service.listPairingRequests(admin,{});
    expect(repository.list).toHaveBeenLastCalledWith({page:1,limit:20},undefined);
    await expect(service.listPairingRequests(user,{userId:'8'})).rejects.toMatchObject({status:400});
  });
  it.each([{page:'0'},{limit:'101'},{status:'invalid'},{status:['pending']},{page:['1','2']}])('rejects invalid filter %j', async q=>{
    await expect(service.listPairingRequests(user,q)).rejects.toMatchObject({status:400});
  });
  it('approves with exactly one assignment/history/audit and consumes code', async ()=>{
    state.requests.push(request());
    await expect(service.approvePairing('10',admin,{reviewNote:' OK '})).resolves.toEqual({status:'APPROVED',assignment:{deviceId:'42',userId:'7'}});
    expect(state.assignments).toHaveLength(1); expect(state.histories).toHaveLength(1);expect(state.audits).toHaveLength(1);
    expect(state.code.usable).toBe(0);expect(state.requests[0]).toMatchObject({status:'approved',reviewNote:'OK'});
    expect(state.device.lifecycleStatus).toBe('assigned');
    expect(tx.findDeviceById.mock.invocationCallOrder[0]).toBeLessThan(tx.findRequest.mock.invocationCallOrder[1]);
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
    expect(state.assignments).toHaveLength(1);
  });
  it('rejects with audit and no assignment/history/code consumption', async ()=>{
    state.requests.push(request());state.device.lifecycleStatus='pending_approval';
    await expect(service.rejectPairing('10',admin,{reviewNote:'Not authorized'})).resolves.toEqual({status:'REJECTED',reviewNote:'Not authorized'});
    expect(state.requests[0].status).toBe('rejected');expect(state.device.lifecycleStatus).toBe('available');
    expect(state.assignments).toHaveLength(0); expect(state.histories).toHaveLength(0);
    expect(state.audits).toHaveLength(1);expect(state.code.usable).toBe(1);
    await expect(service.rejectPairing('10',admin,{})).rejects.toMatchObject({status:409});
  });
  it('keeps pending lifecycle when another request is pending; does not reset maintenance', async ()=>{
    state.requests.push(request(),request('11','8'));state.device.lifecycleStatus='pending_approval';
    await service.rejectPairing('10',admin,{});expect(state.device.lifecycleStatus).toBe('pending_approval');
    state.device.lifecycleStatus='maintenance';await service.rejectPairing('11',admin,{});
    expect(state.device.lifecycleStatus).toBe('maintenance');
  });
  it('concurrent approvals of competing requests yield exactly one owner in the transaction model', async ()=>{
    state.requests.push(request(),request('11','8'));
    const results=await Promise.allSettled([service.approvePairing('10',admin,{}),service.approvePairing('11',admin,{})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
    expect(state.assignments).toHaveLength(1);expect(state.audits).toHaveLength(1);
  });
  it('concurrent approve/reject of the same request has one winner', async ()=>{
    state.requests.push(request());
    const results=await Promise.allSettled([service.approvePairing('10',admin,{}),service.rejectPairing('10',admin,{})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(state.audits).toHaveLength(1);
  });
  it('rolls back all state when the audit fails after assignment', async ()=>{
    state.requests.push(request());const before=structuredClone(state);
    tx.writePairingAudit.mockRejectedValue(new Error('private SQL details'));
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:500,message:'Unable to process pairing request'});
    expect(state).toEqual(before);
  });
  it('rolls back rejection if auditing fails', async ()=>{
    state.requests.push(request());const before=structuredClone(state);
    tx.writePairingAudit.mockRejectedValue(new Error('audit failure'));
    await expect(service.rejectPairing('10',admin,{})).rejects.toMatchObject({status:500});expect(state).toEqual(before);
  });
  it('rolls back creation when request audit fails and never audits the pairing code',async()=>{
    tx.writePairingRequestAudit.mockRejectedValue(new Error('audit failed'));
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:500});
    expect(state.requests).toHaveLength(0);expect(state.device.lifecycleStatus).toBe('available');
    expect(JSON.stringify(tx.writePairingRequestAudit.mock.calls)).not.toContain('ABC123');
  });
  it.each(['revoked','reset_pending','maintenance','assigned','unknown'])('blocks device lifecycle %s', async status=>{
    state.device.lifecycleStatus=status;
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:409});
    state.requests.push(request());await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
    expect(state.assignments).toHaveLength(0);
  });
  it('blocks existing ownership and unconfirmed resets even if lifecycle is available', async ()=>{
    state.assignments.push({deviceId:'42',userId:'8'});
    await expect(service.createPairingRequest(user,{pairingCode:'ABC123'})).rejects.toMatchObject({status:409});
    state.assignments=[];tx.resetAllowsPairing.mockResolvedValue(false);state.requests.push(request());
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
  });
  it('returns 404 for absent request, 409 for invalid approval code and ineligible requester', async ()=>{
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:404});
    state.requests.push(request());state.code.usable=0;
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
    state.code.usable=1;tx.users.findByIdForUpdate.mockImplementation(async (id:string)=>({id,status:id==='7'?'disabled':'active',email_verified_at:new Date()}));
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
  });
  it('enforces roles and rechecks persisted Admin inside transaction', async ()=>{
    await expect(service.approvePairing('10',user,{})).rejects.toMatchObject({status:403});
    await expect(service.rejectPairing('10',user,{})).rejects.toMatchObject({status:403});
    await expect(service.createPairingRequest(admin,{pairingCode:'ABC123'})).rejects.toMatchObject({status:403});
    state.requests.push(request());tx.users.findUserRoles.mockResolvedValue([{code:'USER'}]);
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:403});
  });
  it.each(['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','PAIRING_CONFLICT'])('maps %s to 409', async code=>{
    repository.withTransaction.mockRejectedValue({code});
    await expect(service.approvePairing('10',admin,{})).rejects.toMatchObject({status:409});
  });
});
