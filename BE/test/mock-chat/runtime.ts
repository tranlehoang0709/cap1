/** Development/test-only loopback runtime. Never imported by AppModule. */
import 'reflect-metadata';
import { Controller, ForbiddenException, Get, Injectable, Module, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { UsersService } from '../../src/modules/users/users.service';
import { UsersRepository } from '../../src/modules/users/users.repository';
import { PublicUser } from '../../src/modules/users/users.types';
import { AiController } from '../../src/modules/ai/ai.controller';
import { AiService } from '../../src/modules/ai/ai.service';
import { AiRepository } from '../../src/modules/ai/ai.repository';
import { AIWebChatClient } from '../../src/modules/web-chat/ai-web-chat.client';
import { SecretCipherService } from '../../src/common/crypto/secret-cipher.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { Public } from '../../src/common/decorators/public.decorator';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';

export const FIXTURE = Object.freeze({
  userId: '7', email: 'mock-user@example.test', password: 'MockOnly-Password-2026!',
  robot: Object.freeze({id:'42',device_uid:'MOCK-ROBOT-42',display_name:'MOCK approved robot',
    lifecycle_status:'assigned',connection_status:'offline',owner_user_id:'7',approval_status:'APPROVED'}),
});

@Injectable()
export class MemoryFixtureStore {
  readonly user: PublicUser = {id:FIXTURE.userId,email:FIXTURE.email,display_name:'MOCK fixture User',
    status:'active',email_verified_at:new Date('2026-01-01T00:00:00Z'),last_login_at:null,
    created_at:new Date('2026-01-01T00:00:00Z'),updated_at:new Date('2026-01-01T00:00:00Z')};
  private readonly sessions = new Map<string,Date>();
  private readonly conversations = new Map<string,{id:string;user_id:string;messages:{role:string;content:string}[]}>();
  passwordHash = '';
  assertApproved(userId:string) {
    if(userId!==FIXTURE.robot.owner_user_id || FIXTURE.robot.approval_status!=='APPROVED')
      throw new ForbiddenException('MOCK_APPROVED_OWNERSHIP_REQUIRED');
  }
  async findById(id:string) {return id===this.user.id ? {...this.user}:null;}
  async findUserRoles(id:string) {return id===this.user.id?[{id:2,code:'USER',name:'User'}]:[];}
  async findCredentialsByEmail(email:string) {return email===this.user.email?{...this.user,password_hash:this.passwordHash}:null;}
  async updateLastLogin(id:string) {this.assertApproved(id);}
  async createRefreshSession(id:string,hash:string,expires:Date) {
    this.assertApproved(id);
    if(this.sessions.size>=16)this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(hash,expires);
  }
  async rotateRefreshSession(oldHash:string,newHash:string,expires:Date) {
    const old=this.sessions.get(oldHash);this.sessions.delete(oldHash);
    if(!old||old.getTime()<=Date.now())return false;
    this.sessions.set(newHash,expires);return true;
  }
  async revokeRefreshSession(hash:string) {this.sessions.delete(hash);}
  async createUser() {throw new ServiceUnavailableException('MOCK_REGISTRATION_DISABLED');}
  async verifyEmail() {return false;}
  async findCredentialsById() {return null;}
  async changePassword() {throw new ServiceUnavailableException('MOCK_PASSWORD_CHANGE_DISABLED');}
  async profile(userId:string) {this.assertApproved(userId);return {user_id:userId,assistant_name:'MOCK AIVA',system_prompt:'MOCK only',
    language_code:'vi',voice_code:null,preferred_provider_id:'1',preferred_llm_model_id:'1'};}
  async quotas() {return [];}
  async conversation(id:string,userId:string) {const c=this.conversations.get(id);return c?.user_id===userId?structuredClone(c):null;}
  async listConversations(userId:string) {const c=await this.conversation('11',userId);return {items:c?[c]:[],total:c?1:0};}
  record(userId:string,input:string,reply:{conversation_id:string;content:string}) {
    this.assertApproved(userId);
    // Bounded, process-local conversation only. No writes to fixture/source files or DB.
    this.conversations.clear();
    this.conversations.set(reply.conversation_id,{id:reply.conversation_id,user_id:userId,
      messages:[{role:'user',content:input},{role:'assistant',content:reply.content}]});
  }
}

@Injectable()
class FixtureChatGateway extends AIWebChatClient {
  constructor(config:ConfigService,private readonly memory:MemoryFixtureStore){super(config);}
  override async send(userId:string,content:string) {
    this.memory.assertApproved(userId);
    const result=await super.send(userId,content); // real HTTP client; no retry/fallback
    this.memory.record(userId,content,result);
    return result;
  }
}

@Controller()
class FixtureReadController {
  @Public() @Get('health') health(){return {status:'ok',mode:'MOCK_ONLY'};}
  @Get('devices') devices(){return {items:[FIXTURE.robot],total:1,page:1,limit:100};}
}

export async function createMockBackend(aiUrl:string,serviceToken:string) {
  if(process.env.AIVA_MOCK_MODE!=='development-test' || !['test','development'].includes(process.env.NODE_ENV??''))
    throw new Error('MOCK_RUNTIME_REQUIRES_EXPLICIT_DEVELOPMENT_TEST_MODE');
  const origin=new URL(aiUrl);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
    throw new Error('MOCK_AI_MUST_BE_LOOPBACK_HTTP');
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(serviceToken))throw new Error('MOCK_SERVICE_TOKEN_REQUIRED');
  const memory=new MemoryFixtureStore();memory.passwordHash=await bcrypt.hash(FIXTURE.password,4);
  const config=new ConfigService({auth:{accessTokenSecret:randomBytes(32).toString('base64url'),
    refreshTokenSecret:randomBytes(32).toString('base64url'),accessTokenTtlSeconds:900,refreshTokenTtlSeconds:3600},
    crypto:{encryptionKey:randomBytes(32).toString('base64url')},AI_SERVER_URL:aiUrl,AI_SERVER_WEB_TOKEN:serviceToken});
  @Module({imports:[JwtModule.register({})],controllers:[AuthController,AiController,FixtureReadController],providers:[
    {provide:ConfigService,useValue:config},{provide:MemoryFixtureStore,useValue:memory},
    {provide:AuthRepository,useValue:memory},{provide:UsersRepository,useValue:memory},
    {provide:AiRepository,useValue:{profile:memory.profile.bind(memory),conversation:memory.conversation.bind(memory),
      conversations:memory.listConversations.bind(memory),quotas:memory.quotas.bind(memory)}},
    AuthService,UsersService,AiService,SecretCipherService,JwtAuthGuard,RolesGuard,
    {provide:AIWebChatClient,useClass:FixtureChatGateway},
  ]}) class MockModule {}
  const app=await NestFactory.create(MockModule,{logger:false,abortOnError:false});
  app.useGlobalGuards(app.get(JwtAuthGuard),app.get(RolesGuard));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ApiExceptionFilter());
  return app;
}

if(require.main===module){
  const port=Number(process.env.AIVA_MOCK_BE_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('MOCK_PORT_REQUIRED');
  createMockBackend(process.env.AIVA_MOCK_AI_URL??'',process.env.AIVA_MOCK_SERVICE_TOKEN??'')
    .then(async app=>{await app.listen(port,'127.0.0.1');app.enableShutdownHooks();})
    .catch(()=>{process.stderr.write('MOCK_BACKEND_START_FAILED\n');process.exitCode=1;});
}
