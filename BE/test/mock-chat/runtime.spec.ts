import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { createMockBackend,FIXTURE,MemoryFixtureStore } from './runtime';

const mode=process.env.AIVA_MOCK_MODE;
const environment=process.env.NODE_ENV;
afterAll(()=>{if(mode===undefined)delete process.env.AIVA_MOCK_MODE;else process.env.AIVA_MOCK_MODE=mode;
  if(environment===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=environment;});

describe('Isolated mock runtime uses real password/JWT/chat code',()=>{
  let app:INestApplication;let bearer:string;
  const upstream=jest.spyOn(globalThis,'fetch');
  beforeAll(async()=>{
    process.env.AIVA_MOCK_MODE='development-test';process.env.NODE_ENV='test';
    app=await createMockBackend('http://127.0.0.1:19001',randomBytes(32).toString('base64url'));
    await app.init();
  });
  afterAll(async()=>{await app.close();upstream.mockRestore();});
  it('requires explicit test/development mode and loopback',async()=>{
    process.env.NODE_ENV='production';await expect(createMockBackend('http://127.0.0.1:19001','x'.repeat(43))).rejects.toThrow('EXPLICIT');
    process.env.NODE_ENV='test';await expect(createMockBackend('http://example.com','x'.repeat(43))).rejects.toThrow('LOOPBACK');
  });
  it('does not bypass password authentication or accept missing JWT',async()=>{
    await request(app.getHttpServer()).post('/auth/login').send({email:FIXTURE.email,password:'wrong'}).expect(401);
    await request(app.getHttpServer()).post('/web-chat/messages').send({content:'fixture'}).expect(401);
    const response=await request(app.getHttpServer()).post('/auth/login').send({email:FIXTURE.email,password:FIXTURE.password}).expect(200);
    bearer=response.body.access_token;
    const me=await request(app.getHttpServer()).get('/auth/me').auth(bearer,{type:'bearer'}).expect(200);
    expect(me.body).toMatchObject({id:'7',role:'USER'});
    expect(me.body).not.toHaveProperty('password_hash');
  });
  it('keeps fixture robot approval, owner and conversation scope explicit',async()=>{
    const memory=new MemoryFixtureStore();
    expect(FIXTURE.robot).toMatchObject({owner_user_id:'7',approval_status:'APPROVED'});
    expect(()=>memory.assertApproved('8')).toThrow('OWNERSHIP');
    memory.record('7','synthetic',{conversation_id:'11',content:'[MOCK] scoped'});
    expect(await memory.conversation('11','8')).toBeNull();
    expect(await memory.conversation('11','7')).toMatchObject({user_id:'7'});
  });
  it('forbids public identity/provider overrides before the AI request',async()=>{
    upstream.mockClear();
    await request(app.getHttpServer()).post('/web-chat/messages').auth(bearer,{type:'bearer'})
      .send({content:'fixture',userId:'8'}).expect(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns the actual upstream reply through ownership-checked RAM conversation',async()=>{
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({content:'[MOCK] adapter answer',conversation_id:'11',
      usage:{input_tokens:0,output_tokens:0}}),{headers:{'Content-Type':'application/json'}}));
    const response=await request(app.getHttpServer()).post('/web-chat/messages').auth(bearer,{type:'bearer'}).send({content:'fixture'}).expect(201);
    expect(response.body).toMatchObject({id:'11',user_id:'7',messages:[{role:'user',content:'fixture'},{role:'assistant',content:'[MOCK] adapter answer'}]});
    expect(upstream).toHaveBeenLastCalledWith(expect.any(URL),expect.objectContaining({body:JSON.stringify({userId:'7',content:'fixture'})}));
  });
  it('fails closed on connection error, empty response, and timeout; no retry',async()=>{
    for(const value of ['connection','empty','timeout']){
      upstream.mockClear();
      if(value==='empty')upstream.mockResolvedValueOnce(new Response('{}',{headers:{'Content-Type':'application/json'}}));
      else if(value==='timeout')upstream.mockImplementationOnce(async(_url,init)=>{jest.spyOn(init!.signal!,'aborted','get').mockReturnValue(true);throw new Error('fixture timeout');});
      else upstream.mockRejectedValueOnce(new Error('fixture connection'));
      const response=await request(app.getHttpServer()).post('/web-chat/messages').auth(bearer,{type:'bearer'}).send({content:'fixture'});
      expect(response.status).toBe(value==='timeout'?504:502);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response.body)).not.toContain('fixture connection');
    }
  });
});
