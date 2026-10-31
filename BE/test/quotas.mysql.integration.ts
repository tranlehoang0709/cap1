/** Opt-in only, existing isolated V1.5 schema with the separately approved migration
 * already applied by its operator. No DDL here. These are Backend+MySQL tests, not
 * real provider execution or firmware tests. All rows belong to unique test Users.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createPool,Pool } from 'mysql2/promise';
import { createHmac,randomBytes,randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { QuotasRepository } from '../src/modules/quotas/quotas.repository';
import { validateEnvironment } from '../src/config/configuration';

describe('Opt-in real MySQL quota admission and settlement',()=>{
  let pool:Pool,app:Awaited<ReturnType<typeof NestFactory.create>>,base:string;
  let adminId:string,userA:string,userB:string,providerId:string,modelId:string;
  const userIds:string[]=[],modelIds:string[]=[];const original:Record<string,string|undefined>={};
  const jwtKey=randomBytes(32).toString('base64url'),source=randomBytes(32).toString('base64url'),prefix=`quota_${randomUUID().replace(/-/g,'')}`;
  async function rows(sql:string,values:unknown[]=[]):Promise<any[]>{const [result]=await pool.execute(sql,values as never[]);return result as any[];}
  async function insert(sql:string,values:unknown[]):Promise<string>{const c=await pool.getConnection();try{await c.execute(sql,values as never[]);
    const [result]=await c.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');return (result as any[])[0].id;}finally{c.release();}}
  function token(id:string){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,iss:'quota-test',aud:'quota-test'})).toString('base64url');
    return `${h}.${p}.${createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url')}`;}
  async function api(path:string,method:string,bearer:string,body?:unknown){return fetch(base+path,{method,
    headers:{authorization:`Bearer ${bearer}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  const policyPath=(userId=userA)=>`/admin/ai/quotas/users/${userId}/providers/${providerId}`;
  async function configure(mode:string,limits:Record<string,unknown>={},userId=userA,expectedPolicyId:string|null=null){
    const response=await api(policyPath(userId),'PUT',token(adminId),{mode,expectedPolicyId,...limits});expect(response.status).toBe(200);return response.json();
  }
  const admission=(budget:string|null='10',userId=userA)=>({requestId:`${prefix}_${randomBytes(8).toString('hex')}`,userId,providerId,modelId,...(budget===null?{}:{maxTotalTokens:budget})});
  const usage=(requestId:string,status='success',inputTokens=2,outputTokens=3)=>({requestId,providerId,status,inputTokens,outputTokens,durationMs:100});
  async function clearOwnRows(){
    if(!pool||!userIds.length)return;const placeholders=userIds.map(()=>'?').join(',');
    await rows(`DELETE FROM usage_records WHERE user_id IN (${placeholders})`,userIds);
    await rows(`DELETE FROM quota_policies WHERE user_id IN (${placeholders})`,userIds);
    await rows(`DELETE FROM audit_logs WHERE actor_user_id IN (${placeholders}) OR
      (entity_type='AI_QUOTA' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.userId')) IN (${placeholders}))`,[...userIds,...userIds]);
  }
  beforeAll(async()=>{
    if(process.env.MYSQL_INTEGRATION_TESTS!=='true'||!/^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME??''))throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
    validateEnvironment({...process.env,NODE_ENV:'test'});
    pool=createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectionLimit:10});
    // Check the full uniqueness/FK/type contract before inserting even a fixture User.
    await new QuotasRepository(pool).assertSchema();
    const roles=await rows("SELECT CAST(id AS CHAR) AS id,code FROM roles WHERE code IN ('ADMIN','USER')");
    const providers=await rows("SELECT CAST(id AS CHAR) AS id FROM ai_providers WHERE code='LOCAL' AND is_enabled=1");
    if(roles.length!==2||providers.length!==1)throw new Error('TEST_CATALOG_REQUIRED');providerId=providers[0].id;
    for(const [index,role]of ['ADMIN','USER','USER'].entries()){
      const id=await insert(`INSERT INTO users(email,password_hash,display_name,status,email_verified_at,created_at,updated_at)
        VALUES(?,'synthetic-not-login',?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,[`${prefix}_${index}@example.test`,`${prefix}_${index}`]);
      userIds.push(id);await rows('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)',[id,roles.find(r=>r.code===role).id]);
    }
    [adminId,userA,userB]=userIds;modelId=await insert("INSERT INTO ai_models(provider_id,model_code,capability,is_enabled) VALUES(?,?,'llm',1)",[providerId,prefix]);modelIds.push(modelId);
    const environment:Record<string,string>={NODE_ENV:'test',HEARTBEAT_SWEEPER_ENABLED:'false',AI_USAGE_REPORT_SWEEPER_ENABLED:'false',
      ADMIN_ACCESS_JWT_SECRET:jwtKey,ADMIN_ACCESS_JWT_ISSUER:'quota-test',ADMIN_ACCESS_JWT_AUDIENCE:'quota-test',
      AI_QUOTA_CONTRACT_APPROVED:'true',AI_QUOTA_SERVICE_TOKEN:source,AI_USAGE_REPORT_TIMEOUT_SECONDS:'30',AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS:''};
    for(const [name,value]of Object.entries(environment)){original[name]=process.env[name];process.env[name]=value;}
    const {AppModule}=await import('../src/app.module');app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');
    base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  beforeEach(async()=>{await clearOwnRows();if(app)app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','true');});
  afterAll(async()=>{
    try{if(app)await app.close();if(pool){await clearOwnRows();
      const remove=async(table:string,column:string,ids:string[])=>{if(ids.length)await rows(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(()=>'?').join(',')})`,ids);};
      await remove('user_roles','user_id',userIds);await remove('users','id',userIds);await remove('ai_models','id',modelIds);
    }}finally{if(pool)await pool.end();for(const name of Object.keys(original)){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}}
  });
  it('UNLIMITED logs usage, BLOCKED denies, and unauthorized Admin mutation does not create a policy',async()=>{
    expect((await api(policyPath(),'PUT',token(userA),{mode:'UNLIMITED',expectedPolicyId:null})).status).toBe(403);
    const policy=await configure('UNLIMITED');const input=admission(null);
    const allow=await api('/internal/ai/authorize-request','POST',source,input);expect(allow.status).toBe(200);expect(await allow.json()).toMatchObject({allowed:true,mode:'UNLIMITED'});
    expect((await api('/internal/ai/usage','POST',source,usage(input.requestId))).status).toBe(200);
    await configure('BLOCKED',{},userA,policy.policyId);
    expect((await api('/internal/ai/authorize-request','POST',source,admission())).status).toBe(403);
    expect((await rows('SELECT id FROM usage_records WHERE user_id=?',[userA]))).toHaveLength(1);
  });
  it('real concurrent connections cannot exceed LIMITED rate or token reservations',async()=>{
    await configure('LIMITED',{requestsPerMinute:10,requestsPerDay:100,tokensPerMonth:'30'});
    const results=await Promise.all(Array.from({length:10},()=>api('/internal/ai/authorize-request','POST',source,admission('10'))));
    expect(results.filter(r=>r.status===200)).toHaveLength(3);expect(results.filter(r=>r.status===429)).toHaveLength(7);
    const counts=await rows('SELECT COUNT(*) AS count,CAST(SUM(reserved_tokens) AS CHAR) AS held FROM usage_records WHERE user_id=?',[userA]);expect(Number(counts[0].count)).toBe(3);expect(counts[0].held).toBe('30');
  });
  it('duplicate requestId and duplicate final reports mutate a single row once',async()=>{
    await configure('LIMITED',{requestsPerMinute:10,requestsPerDay:100,tokensPerMonth:'100'});const input=admission();
    const admissions=await Promise.all([api('/internal/ai/authorize-request','POST',source,input),api('/internal/ai/authorize-request','POST',source,input)]);
    expect(admissions.every(r=>r.status===200)).toBe(true);const bodies=await Promise.all(admissions.map(r=>r.json()));expect(bodies.filter(b=>b.executionAllowed)).toHaveLength(1);
    const reports=await Promise.all([api('/internal/ai/usage','POST',source,usage(input.requestId)),api('/internal/ai/usage','POST',source,usage(input.requestId))]);expect(reports.every(r=>r.status===200)).toBe(true);
    const saved=await rows('SELECT input_tokens AS inputTokens,output_tokens AS outputTokens,status FROM usage_records WHERE request_id=?',[input.requestId]);expect(saved).toEqual([{inputTokens:2,outputTokens:3,status:'success'}]);
    expect((await api('/internal/ai/usage','POST',source,usage(input.requestId,'success',2,4))).status).toBe(409);
    expect((await api('/internal/ai/authorize-request','POST',source,{...input,maxTotalTokens:'11'})).status).toBe(409);
  });
  it('missing reports retain budget, late cancelled usage releases it, and reports work after admission is disabled',async()=>{
    await configure('LIMITED',{requestsPerMinute:10,requestsPerDay:null,tokensPerMonth:'10'});const input=admission('10');
    expect((await api('/internal/ai/authorize-request','POST',source,input)).status).toBe(200);
    await rows('UPDATE usage_records SET report_due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE request_id=? AND user_id=?',[input.requestId,userA]);
    const replay=await api('/internal/ai/authorize-request','POST',source,input);expect(await replay.json()).toMatchObject({allowed:false,reason:'USAGE_REPORT_MISSING'});
    expect((await api('/internal/ai/authorize-request','POST',source,admission('1'))).status).toBe(429);
    app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','false');expect((await api('/internal/ai/usage','POST',source,usage(input.requestId,'cancelled',0,0))).status).toBe(200);
    app.get(ConfigService).set('AI_QUOTA_CONTRACT_APPROVED','true');expect((await api('/internal/ai/authorize-request','POST',source,admission('10'))).status).toBe(200);
  });
  it('policy changes preserve counts and reject finite caps while unbounded work is unresolved',async()=>{
    const policy=await configure('UNLIMITED');const input=admission(null);expect((await api('/internal/ai/authorize-request','POST',source,input)).status).toBe(200);
    const body={mode:'LIMITED',expectedPolicyId:policy.policyId,requestsPerMinute:1,requestsPerDay:1,tokensPerMonth:'100'};
    expect((await api(policyPath(),'PUT',token(adminId),body)).status).toBe(409);
    expect((await api('/internal/ai/usage','POST',source,usage(input.requestId,'failed',0,0))).status).toBe(200);
    expect((await api(policyPath(),'PUT',token(adminId),body)).status).toBe(200);
    expect((await api('/internal/ai/authorize-request','POST',source,admission())).status).toBe(429);
    expect((await rows('SELECT id FROM usage_records WHERE user_id=?',[userA]))).toHaveLength(1);
  });
  it('missing/duplicate policies fail closed and User usage cannot read another tenant',async()=>{
    expect((await api('/internal/ai/authorize-request','POST',source,admission())).status).toBe(403);
    await configure('UNLIMITED');await configure('UNLIMITED',{},userB);
    const input=admission(null,userB);expect((await api('/internal/ai/authorize-request','POST',source,input)).status).toBe(200);
    const mine=await api(`/user/ai/usage?providerId=${providerId}`,'GET',token(userA));expect(await mine.json()).toMatchObject({requestsUsed:'0'});
    expect((await api(`/user/ai/usage?userId=${userB}`,'GET',token(userA))).status).toBe(400);
    await insert(`INSERT INTO quota_policies(user_id,provider_id,requests_per_minute,requests_per_day,tokens_per_month,is_active,created_at,updated_at)
      VALUES(?,?,NULL,NULL,NULL,1,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,[userA,providerId]);
    expect((await api('/internal/ai/authorize-request','POST',source,admission())).status).toBe(409);
    expect((await api(policyPath(),'GET',token(adminId))).status).toBe(409);
  });
});
