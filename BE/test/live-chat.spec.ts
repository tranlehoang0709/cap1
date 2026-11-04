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
  it('propagates quota denial without provider retries',async()=>{
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:429}));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({status:429});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('normalizes unavailable AI Server without exposing exceptions',async()=>{
    jest.spyOn(globalThis,'fetch').mockRejectedValue(new Error('private-token-value'));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE'});
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
    const {tx,service}=setup();tx.rows.mockResolvedValueOnce([{conversationId:'11',status:'completed',deviceId:null}]).mockResolvedValueOnce([{providerId:'2'}]).mockResolvedValueOnce([{save:1}]).mockResolvedValueOnce([{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]);
    await expect(service.completeTurn(body)).resolves.toMatchObject({saved:true});
    expect(tx.rows.mock.calls.some(c=>c[0].startsWith('INSERT'))).toBe(false);
  });
});
