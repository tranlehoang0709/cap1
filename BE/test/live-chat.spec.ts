import { ConfigService } from '@nestjs/config';
import { AiService } from '../src/modules/ai/ai.service';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';

describe('BE live chat boundary',()=>{
  const token='t'.repeat(43);
  const config=new ConfigService({AI_SERVER_URL:'http://127.0.0.1:8000',AI_SERVER_WEB_TOKEN:token});
  const service=new AiService({} as never,{} as never,config);
  afterEach(()=>jest.restoreAllMocks());
  it('forwards trusted user ID and returns only safe response fields',async()=>{
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'Hello',conversation_id:'11',
      credential:'must-not-leak',usage:{input_tokens:2,output_tokens:3,credential:'must-not-leak'}}),{headers:{'Content-Type':'application/json'}}));
    const result=await service.chat('7','Hi','2');
    expect(result).toEqual({content:'Hello',conversation_id:'11',usage:{input_tokens:2,output_tokens:3}});
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({userId:'7',providerId:'2',content:'Hi'});
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });
  it('forwards conversationId for multi-turn continuation and resolves provider when omitted',async()=>{
    const repo={providers:jest.fn().mockResolvedValue([{id:'3',code:'LOCAL',is_enabled:true}])};
    const svc=new AiService(repo as never,{} as never,config);
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'Next turn',conversation_id:'11',
      usage:{input_tokens:5,output_tokens:4}}),{headers:{'Content-Type':'application/json'}}));
    const result=await svc.chat('7','Continue please',undefined,'11');
    expect(result).toEqual({content:'Next turn',conversation_id:'11',usage:{input_tokens:5,output_tokens:4}});
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({userId:'7',providerId:'3',content:'Continue please',conversationId:'11'});
  });
  it('propagates quota denial without provider retries',async()=>{
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:429}));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({status:429});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('normalizes unavailable AI Server without exposing exceptions',async()=>{
    jest.spyOn(globalThis,'fetch').mockRejectedValue(new Error('private-token-value'));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE'});
  });
  it('accepts private LAN HTTP AI Server origin for two-machine deployment',async()=>{
    const lanConfig=new ConfigService({AI_SERVER_URL:'http://192.168.1.50:8001',AI_SERVER_WEB_TOKEN:token});
    const lanService=new AiService({} as never,{} as never,lanConfig);
    jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'LAN reply',conversation_id:'12',
      usage:{input_tokens:3,output_tokens:4}}),{headers:{'Content-Type':'application/json'}}));
    await expect(lanService.chat('7','Hi','1')).resolves.toEqual({content:'LAN reply',conversation_id:'12',usage:{input_tokens:3,output_tokens:4}});
  });
});

describe('turn persistence requires committed real usage',()=>{
  function setup(){
    const tx={users:{findByIdForUpdate:jest.fn().mockResolvedValue({status:'active',email_verified_at:new Date()}),findUserRoles:jest.fn().mockResolvedValue([{code:'USER'}])},
      rows:jest.fn(),ownership:{verifyDeviceOwnership:jest.fn().mockResolvedValue({id:'42'})}};
    const repo={transaction:jest.fn(async(work)=>work(tx))};
    return {tx,service:new AiProvidersService(repo as never,{} as never,new ConfigService())};
  }
  const body={userId:'7',sessionId:'12',requestId:'r'.repeat(16),content:'Hi',response:'Hello'};
  it('refuses messages before usage settlement',async()=>{
    const {tx,service}=setup();tx.rows.mockResolvedValueOnce([{conversationId:'11',status:'active',deviceId:null}]).mockResolvedValueOnce([]);
    await expect(service.completeTurn(body)).rejects.toThrow('USAGE_NOT_SETTLED');
    expect(tx.rows.mock.calls.some(c=>c[0].startsWith('INSERT'))).toBe(false);
  });
  it('writes user/assistant messages once after success and closes the session',async()=>{
    const {tx,service}=setup();tx.rows.mockResolvedValueOnce([{conversationId:'11',status:'active',deviceId:null}]).mockResolvedValueOnce([{providerId:'2'}]).mockResolvedValueOnce([{save:1}]).mockResolvedValue([]);
    await expect(service.completeTurn(body)).resolves.toEqual({conversationId:'11',sessionId:'12',saved:true});
    expect(tx.rows.mock.calls.filter(c=>c[0].startsWith('INSERT INTO messages'))).toHaveLength(1);
  });
  it('honors disabled history without persisting message content',async()=>{
    const {tx,service}=setup();tx.rows.mockResolvedValueOnce([{conversationId:'11',status:'active',deviceId:null}]).mockResolvedValueOnce([{providerId:'2'}]).mockResolvedValueOnce([{save:0}]).mockResolvedValue([]);
    await expect(service.completeTurn(body)).resolves.toMatchObject({saved:false});
    expect(tx.rows.mock.calls.some(c=>c[0].startsWith('INSERT INTO messages'))).toBe(false);
  });
  it('replays identical completed turns without duplicate message writes',async()=>{
    const {tx,service}=setup();tx.rows.mockResolvedValueOnce([{conversationId:'11',status:'completed',deviceId:null}]).mockResolvedValueOnce([{providerId:'2'}]).mockResolvedValueOnce([{save:1}]).mockResolvedValueOnce([{role:'user',content:'Earlier'},{role:'assistant',content:'Earlier reply'},{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]);
    await expect(service.completeTurn(body)).resolves.toMatchObject({saved:true});
    expect(tx.rows.mock.calls.some(c=>c[0].startsWith('INSERT'))).toBe(false);
  });
  it('starts a multi-turn continuation on an existing web conversation and loads history',async()=>{
    const {tx,service}=setup();
    tx.rows
      .mockResolvedValueOnce([{id:'11',userId:'7',deviceId:null,channel:'web',status:'active',deletedAt:null}])
      .mockResolvedValueOnce([{role:'user',content:'First question'},{role:'assistant',content:'Hello there'}])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{id:'15'}]);
    const res=await service.startTurn({userId:'7',channel:'web',conversationId:'11'});
    expect(res).toEqual({
      conversationId:'11',
      sessionId:'15',
      history:[{role:'user',content:'First question'},{role:'assistant',content:'Hello there'}],
    });
  });
  it('rejects continuing a closed or deleted conversation',async()=>{
    const {tx,service}=setup();
    tx.rows.mockResolvedValueOnce([{id:'11',userId:'7',deviceId:null,channel:'web',status:'ended',deletedAt:null}]);
    await expect(service.startTurn({userId:'7',channel:'web',conversationId:'11'})).rejects.toMatchObject({status:409});
  });
});
