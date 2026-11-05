import 'reflect-metadata';
import { Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { UsersService } from '../src/modules/users/users.service';
import { AiRepository } from '../src/modules/ai/ai.repository';
import { AiService } from '../src/modules/ai/ai.service';
import { SecretCipherService } from '../src/common/crypto/secret-cipher.service';
import { AiController } from '../src/modules/ai/ai.controller';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

import { BadGatewayException } from '@nestjs/common';
import { AIWebChatClient } from '../src/modules/web-chat/ai-web-chat.client';
const secret='isolated-test-only-auth-secret-not-production';
const config=new ConfigService({auth:{accessTokenSecret:secret}});
const jwt=new JwtService();
const users={canLogin:jest.fn(),getUserRole:jest.fn(),getUserById:jest.fn()};

const webToken = 'w'.repeat(43);

describe('Phase 1 Web Chat real caller; provider execution is always a fixture here', () => {
  const reply = {content: 'Fixture answer.', conversation_id: '9007199254740993', usage: {input_tokens: 8, output_tokens: 4}};
  let client: AIWebChatClient, config: ConfigService, fetcher: jest.SpyInstance;
  beforeEach(() => {
    config = new ConfigService({AI_SERVER_URL: 'http://127.0.0.1:8000', AI_SERVER_WEB_TOKEN: webToken});
    client = new AIWebChatClient(config);
    fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(reply), {headers: {'Content-Type': 'application/json'}}));
  });
  afterEach(() => {jest.restoreAllMocks();jest.useRealTimers();});
  it('forwards only the server-bound user/content and its separate token', async () => {
    expect(await client.send('7', 'Question')).toEqual(reply);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8000/internal/web-chat');
    expect(JSON.parse(options.body)).toEqual({userId: '7', content: 'Question'});
    expect(options.headers.Authorization).toBe('Bearer ' + webToken);
    expect(options.redirect).toBe('error'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['http://192.168.1.5:8000', 'http://evil.invalid', 'https://example.test/other', 'https://user:pass@example.test'])('rejects unsafe configured origin %s', async origin => {
    config.set('AI_SERVER_URL', origin);
    await expect(client.send('7', 'Question')).rejects.toThrow('AI_SERVER_NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires a real provisioned token and never falls back to Mock', async () => {
    config.set('AI_SERVER_WEB_TOKEN', '');
    await expect(client.send('7', 'Question')).rejects.toThrow('AI_SERVER_NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds output, rejects unknown response formats and never echoes upstream bodies', async () => {
    fetcher.mockResolvedValueOnce(new Response('private secret detail', {status: 503}));
    await expect(client.send('7', 'Question')).rejects.toThrow('AI_SERVER_UNAVAILABLE');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({...reply, content: 'x'.repeat(501)}), {headers: {'Content-Type': 'application/json'}}));
    await expect(client.send('7', 'Question')).rejects.toBeInstanceOf(BadGatewayException);
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(70001), {headers: {'Content-Type': 'application/json'}}));
    await expect(client.send('7', 'Question')).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('aborts a stalled request and does not retry', async () => {
    jest.useFakeTimers();
    fetcher.mockImplementation((_url: any, options: any) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const failure = expect(client.send('7', 'Question')).rejects.toThrow('AI_SERVER_TIMEOUT');
    await jest.advanceTimersByTimeAsync(95000);
    await failure; expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns only the persisted conversation belonging to JWT user without a second usage write', async () => {
    const repo = {conversation: jest.fn().mockResolvedValue({id: reply.conversation_id, user_id: '7', messages: [{role: 'assistant', content: reply.content}]}),
      createConversation: jest.fn(), quota: jest.fn()};
    const gateway = {send: jest.fn().mockResolvedValue(reply)};
    const service = new AiService(repo as any, {} as any, gateway as any);
    expect(await service.chat('7', 'Question')).toMatchObject({id: reply.conversation_id});
    expect(gateway.send).toHaveBeenCalledWith('7', 'Question');
    expect(repo.conversation).toHaveBeenCalledWith(reply.conversation_id, '7');
    expect(repo.createConversation).not.toHaveBeenCalled(); expect(repo.quota).not.toHaveBeenCalled();
    repo.conversation.mockResolvedValueOnce({id: reply.conversation_id, user_id: '7', messages: []});
    await expect(service.chat('7', 'Question')).rejects.toThrow('AI_TURN_NOT_PERSISTED');
    repo.conversation.mockResolvedValue(null);
    await expect(service.chat('7', 'Question')).rejects.toThrow('AI_TURN_NOT_PERSISTED');
  });
});

describe('Web Chat rejects client-owned model/provider/identity overrides', () => {
  it.each(['provider_id', 'providerId', 'modelId', 'userId'])('rejects %s in the public DTO', async field => {
    const { validate } = await import('class-validator');
    const { ChatDto } = await import('../src/modules/ai/dto/ai.dto');
    const errors = await validate(Object.assign(new ChatDto(), {content: 'Question', [field]: '8'}),
      {whitelist: true, forbidNonWhitelisted: true});
    expect(errors.some(error => error.property === field)).toBe(true);
  });
});

describe('Models service/repository contract without database',()=>{
 const repo={provider:jest.fn(),models:jest.fn()};
 const service=new AiService(repo as unknown as AiRepository,{} as SecretCipherService);
 it('rejects missing provider',async()=>{
  repo.provider.mockResolvedValue(null);
  await expect(service.models('7')).rejects.toMatchObject({code:'PROVIDER_NOT_FOUND'});
  expect(repo.models).not.toHaveBeenCalled();
 });
 it('returns empty for provider without enabled models',async()=>{
  repo.provider.mockResolvedValue({id:'7'});repo.models.mockResolvedValue([]);
  await expect(service.models('7')).resolves.toEqual([]);
 });
 it.each(['0','01','bad','9223372036854775808'])('rejects invalid ID %s',async id=>{
  await expect(service.models(id)).rejects.toMatchObject({status:400});
 });
 it('SQL filters disabled and keeps BIGINT IDs as strings',async()=>{
  const pool={execute:jest.fn(async(sql:string)=>[sql.includes('AND is_enabled=1')?
   [{id:'9007199254740993',provider_id:'7',model_code:'fixture',capability:'LLM',is_enabled:1}]:
   [{id:'1',is_enabled:0}],[]])};
  const repository=new AiRepository(pool as any);
  expect(await repository.models('7')).toEqual([{id:'9007199254740993',provider_id:'7',model_code:'fixture',capability:'LLM',is_enabled:true}]);
  expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('AND is_enabled=1'),['7']);
 });
 it('missing provider maps to HTTP 404 without SQL leakage',async()=>{
  repo.provider.mockResolvedValue(null);
  const mod=await Test.createTestingModule({controllers:[AiController],providers:[{provide:AiService,useValue:service}]}).compile();
  const app=mod.createNestApplication();app.useGlobalFilters(new ApiExceptionFilter());await app.init();
  try {const response=await request(app.getHttpServer()).get('/ai/providers/7/models');
   expect(response.status).toBe(404);expect(response.body.code).toBe('PROVIDER_NOT_FOUND');
   expect(JSON.stringify(response.body)).not.toMatch(/SELECT|ai_models/);
  }finally{await app.close();}
 });
});


describe('AI Profile partial PATCH with JWT ownership and no database',()=>{
 let app:any;
 let stored:any;
 const repo={patchProfile:jest.fn(),provider:jest.fn(),model:jest.fn()};
 const service=new AiService(repo as unknown as AiRepository,{} as SecretCipherService);
 beforeAll(async()=>{
  const mod=await Test.createTestingModule({controllers:[AiController],providers:[{provide:AiService,useValue:service}]}).compile();
  app=mod.createNestApplication();
  app.useGlobalGuards(new JwtAuthGuard(new Reflector(),jwt,config,users as unknown as UsersService));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ApiExceptionFilter());await app.init();
 });
 afterAll(async()=>{await app.close();});
 beforeEach(()=>{
  jest.clearAllMocks();
  stored={user_id:'7',assistant_name:'Original',system_prompt:'Original prompt',language_code:'vi',voice_code:'voice',
   preferred_provider_id:'2',preferred_llm_model_id:'3'};
  users.getUserById.mockResolvedValue({id:'7',email:'fixture@example.test',display_name:'Fixture',status:'active',email_verified_at:new Date()});
  users.getUserRole.mockResolvedValue('USER');
  repo.provider.mockResolvedValue({id:'2',is_enabled:true});
  repo.model.mockResolvedValue({id:'3',provider_id:'2',is_enabled:true,capability:'llm'});
  repo.patchProfile.mockImplementation(async(id,patch,validate)=>{
   const next={...stored,...patch};await validate(next,repo);stored=next;return stored;
  });
 });
 function patch(body:Record<string,unknown>){
  const value=jwt.sign({sub:'7',typ:'access'},{secret,issuer:'aiva-iot',audience:'aiva-api',expiresIn:60});
  return request(app.getHttpServer()).patch('/ai/profile').set('Authorization','Bearer '+value).send(body);
 }
 it('one field preserves the other five and binds owner to JWT',async()=>{
  const original={...stored};const response=await patch({assistant_name:'Changed'});
  expect(response.status).toBe(200);
  expect(response.body).toEqual({...original,assistant_name:'Changed'});
  expect(repo.patchProfile).toHaveBeenCalledWith('7',{assistant_name:'Changed'},expect.any(Function));
 });
 it('explicit null clears while omitted stays unchanged',async()=>{
  const response=await patch({system_prompt:null});
  expect(response.status).toBe(200);expect(response.body.system_prompt).toBeNull();
  expect(response.body.voice_code).toBe('voice');
 });
 it('permits clearing provider and model together without fallback',async()=>{
  expect((await patch({preferred_provider_id:null,preferred_llm_model_id:null})).status).toBe(200);
  expect(stored.preferred_provider_id).toBeNull();expect(stored.preferred_llm_model_id).toBeNull();
 });
 it('rejects clearing provider while retaining an incompatible model',async()=>{
  expect((await patch({preferred_provider_id:null})).status).toBe(409);
  expect(stored.preferred_provider_id).toBe('2');
 });
 it('rejects empty body and owner injection',async()=>{
  expect((await patch({})).status).toBe(400);
  expect((await patch({assistant_name:'Changed',user_id:'8'})).status).toBe(400);
  expect(repo.patchProfile).not.toHaveBeenCalled();
 });
 it('rejects unavailable provider',async()=>{
  repo.provider.mockResolvedValue(null);
  expect((await patch({preferred_provider_id:'9'})).status).toBe(409);
  repo.provider.mockResolvedValue({is_enabled:false});
  expect((await patch({preferred_provider_id:'9'})).status).toBe(409);
 });
 it.each([
  null,
  {provider_id:'8',is_enabled:true,capability:'LLM'},
  {provider_id:'2',is_enabled:false,capability:'LLM'},
  {provider_id:'2',is_enabled:true,capability:'TTS'}
 ])('rejects missing, foreign, disabled or non-LLM model',async model=>{
  repo.model.mockResolvedValue(model);
  const response=await patch({preferred_llm_model_id:'9'});
  expect(response.status).toBe(409);expect(response.body.code).toBe('PROFILE_MODEL_CONFLICT');
  expect(stored.preferred_llm_model_id).toBe('3');
 });
 it('rejects invalid IDs and lengths before persistence',async()=>{
  expect((await patch({preferred_provider_id:'not-an-id'})).status).toBe(400);
  expect((await patch({assistant_name:'x'.repeat(101)})).status).toBe(400);
  expect(repo.patchProfile).not.toHaveBeenCalled();
 });
 it('DB failure is not reported as successful and SQL is sanitized',async()=>{
  repo.patchProfile.mockRejectedValueOnce(new Error('SELECT private fixture'));
  const response=await patch({assistant_name:'Changed'});
  expect(response.status).toBe(500);expect(JSON.stringify(response.body)).not.toMatch(/SELECT|private fixture/);
 });
});

describe('Profile repository transaction and field allowlist',()=>{
 it('updates only provided column, locks User and commits after saved read',async()=>{
  const execute=jest.fn()
   .mockResolvedValueOnce([[{id:'7'}]])
   .mockResolvedValueOnce([[{user_id:'7',assistant_name:'Original',voice_code:'voice'}]])
   .mockResolvedValueOnce([{}])
   .mockResolvedValueOnce([[{user_id:'7',assistant_name:'Changed',voice_code:'voice'}]]);
  const c={execute,beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
  const repo=new AiRepository({getConnection:jest.fn(async()=>c)} as any);
  const result=await repo.patchProfile('7',{assistant_name:'Changed'},async()=>{});
  expect(result.voice_code).toBe('voice');
  expect(execute.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(execute.mock.calls[2][0]).toContain('assistant_name=VALUES(assistant_name)');
  expect(execute.mock.calls[2][0]).not.toContain('voice_code=');
  expect(execute.mock.calls[2][1]).toEqual(['7','Changed']);
  expect(c.commit).toHaveBeenCalledTimes(1);expect(c.rollback).not.toHaveBeenCalled();expect(c.release).toHaveBeenCalled();
 });
 it('validation conflict rolls back without writing or committing',async()=>{
  const c={execute:jest.fn().mockResolvedValueOnce([[{id:'7'}]]).mockResolvedValueOnce([[]]),
   beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()};
  const repo=new AiRepository({getConnection:jest.fn(async()=>c)} as any);
  await expect(repo.patchProfile('7',{preferred_provider_id:'2'},async()=>{throw new Error('fixture');})).rejects.toThrow('fixture');
  expect(c.execute).toHaveBeenCalledTimes(2);expect(c.rollback).toHaveBeenCalled();expect(c.commit).not.toHaveBeenCalled();expect(c.release).toHaveBeenCalled();
 });
});
