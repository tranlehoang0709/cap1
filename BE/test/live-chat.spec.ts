import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AiService } from '../src/modules/ai/ai.service';
import { AiProvidersService } from '../src/modules/ai-providers/ai-providers.service';
import { AuthService } from '../src/modules/auth/auth.service';

describe('BE live chat boundary',()=>{
  const token='t'.repeat(43);
  const signingKey='test-only-pa08-delegation-signature-key-32bytes';
  function setup(origin='http://127.0.0.1:8002') {
    const config=new ConfigService({AI_SERVER_LOCAL_URL:origin,toolExecution:{serviceToken:token},auth:{accessTokenSecret:signingKey}});
    const users={canLogin:jest.fn().mockResolvedValue({allowed:true})};
    const jwt=new JwtService();
    const auth=new AuthService({} as never,users as never,jwt,config);
    const delegate=jest.spyOn(auth,'issueToolDelegation');
    const chats={turn:jest.fn(async(userId,requestId,content,conversationId,run)=>({...await run({conversationId:conversationId??'11',sessionId:'web_101'}),conversation_id:conversationId??'11'}))};
    return {service:new AiService({} as never,{} as never,config,auth,chats as never),users,jwt,delegate,config,chats};
  }
  afterEach(()=>jest.restoreAllMocks());
  it('forwards trusted user ID and returns only safe response fields',async()=>{
    const {service,jwt,delegate}=setup();
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'Hello',tool:'schedule.query',grounded:true,
      credential:'must-not-leak',delegation:'must-not-leak',usage:{credential:'must-not-leak'}}),{headers:{'Content-Type':'application/json'}}));
    const result=await service.chat('7','Hi','2');
    expect(result).toEqual({content:'Hello',tool:'schedule.query',grounded:true,conversation_id:'11'});
    const [url,options]=f.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8002/internal/pa08-chat');
    expect(options).toMatchObject({method:'POST',redirect:'error',headers:{'X-AI-Tool-Service':token,'Content-Type':'application/json'}});
    const body=JSON.parse(options?.body as string);
    expect(body).toEqual({user_id:'7',session_id:'web_101',content:'Hi',timezone:'Asia/Bangkok',
      delegation:expect.any(String),stream:false,personalize:false});
    expect(delegate).toHaveBeenCalledWith('7','schedule.query',body.session_id);
    const claims=await jwt.verifyAsync(body.delegation,{secret:signingKey,issuer:'aiva-iot',audience:'aiva-backend-tool-execution'});
    expect(claims).toMatchObject({sub:'7',typ:'tool_delegation',scope:'schedule.query',sid:body.session_id});
    expect(claims.exp-claims.iat).toBe(60);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result).not.toHaveProperty('delegation');
  });
  it('reuses the persisted PA08 session and returns the conversation identifier',async()=>{
    const {service}=setup();
    const f=jest.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({content:'Next turn',tool:null,grounded:false})));
    await expect(service.chat('7','Continue please',undefined,'11')).resolves.toEqual({content:'Next turn',tool:null,grounded:false,conversation_id:'11'});
    await service.chat('7','Another turn','3','11');
    const bodies=f.mock.calls.map(call=>JSON.parse(call[1]?.body as string));
    expect(bodies[0].session_id).toBe(bodies[1].session_id);
    for(const body of bodies){
      expect(body.user_id).toBe('7');
      expect(body).not.toHaveProperty('conversationId');expect(body).not.toHaveProperty('conversation_id');
      expect(body).not.toHaveProperty('providerId');expect(body).not.toHaveProperty('provider_id');
      expect(body.delegation).toEqual(expect.any(String));
    }
  });
  it('propagates quota denial without provider retries',async()=>{
    const {service}=setup();
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:429}));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({status:429});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('normalizes unavailable AI Server without exposing exceptions',async()=>{
    const {service}=setup();
    const f=jest.spyOn(globalThis,'fetch').mockRejectedValue(new Error('private-token-value'));
    await expect(service.chat('7','Hi','2')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE',message:'Local AI Server could not complete the request'});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('accepts private LAN HTTP AI Server origin for two-machine deployment',async()=>{
    const {service}=setup('http://192.168.1.50:8002');
    const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'LAN reply',tool:null,grounded:false})));
    await expect(service.chat('7','Hi','1')).resolves.toEqual({content:'LAN reply',tool:null,grounded:false,conversation_id:'11'});
    expect(String(f.mock.calls[0][0])).toBe('http://192.168.1.50:8002/internal/pa08-chat');
  });
  it('rejects an ineligible user before contacting AI_SERVER',async()=>{
    const {service,users}=setup();users.canLogin.mockResolvedValue({allowed:false});
    const f=jest.spyOn(globalThis,'fetch');
    await expect(service.chat('7','Hi')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f).not.toHaveBeenCalled();
  });
  it('fails closed without AuthService or without service authentication',async()=>{
    const {config}=setup();const f=jest.spyOn(globalThis,'fetch');
    await expect(new AiService({} as never,{} as never,config).chat('7','Hi')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE'});
    const {service,config:missingToken}=setup();missingToken.set('toolExecution.serviceToken','');
    await expect(service.chat('7','Hi')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE'});
    expect(f).not.toHaveBeenCalled();
  });
  it.each([401,403,429,500])('handles upstream status %s without retries or leaking body',async status=>{
    const {service}=setup();const f=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('private upstream detail',{status}));
    await expect(service.chat('7','Hi')).rejects.toMatchObject({status:status===500?503:status,message:'AI_REQUEST_FAILED'});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([{}, {content:42}, {content:'x'.repeat(8001)}])('rejects invalid PA08 content %#',async body=>{
    const {service}=setup();jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(service.chat('7','Hi')).rejects.toMatchObject({code:'AI_PIPELINE_UNAVAILABLE'});
  });
  it('normalizes absent tool and nonboolean grounded without trusting truthy values',async()=>{
    const {service}=setup();jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({content:'Hello',grounded:'true'})));
    await expect(service.chat('7','Hi')).resolves.toEqual({content:'Hello',tool:null,grounded:false,conversation_id:'11'});
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
