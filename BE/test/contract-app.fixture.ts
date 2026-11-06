import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { UsersService } from '../src/modules/users/users.service';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

/** Test-only JWT and mocked identity store. Never loads AppModule or DB configuration. */
export async function contractApp(controller:any, providers:any[]){
  const secret='test-only-contract-signing-secret-32-bytes';
  const users={getUserById:async(id:string)=>({id,status:'active',email_verified_at:new Date()}),
    getUserRole:async(id:string)=>id==='1'?'ADMIN':'USER'};
  const module=await Test.createTestingModule({imports:[JwtModule.register({})],controllers:[controller],providers:[
    JwtAuthGuard,RolesGuard,{provide:UsersService,useValue:users},
    {provide:ConfigService,useValue:new ConfigService({auth:{accessTokenSecret:secret}})},...providers,
  ]}).compile();
  const app:INestApplication=module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
  app.useGlobalGuards(module.get(JwtAuthGuard),module.get(RolesGuard));app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  const token=(id:string)=>module.get(JwtService).signAsync({sub:id,typ:'access'},
    {secret,issuer:'aiva-iot',audience:'aiva-api',expiresIn:60});
  return {app,token};
}
