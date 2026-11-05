import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
// Real JWT crypto; isolated repository. No email is sent and no LIVE mailbox claim.
describe('Local email verification contract',()=>{
 const secret='unit-only-email-contract-secret-32bytes';
 const config=new ConfigService({auth:{accessTokenSecret:secret}});
 const jwt=new JwtService();
 it('accepts only its issued email-verification audience/type',async()=>{
  const repo={verifyEmail:jest.fn().mockResolvedValue(true)};
  const service=new AuthService(repo as any,{} as any,jwt,config);
  const token=await jwt.signAsync({sub:'7',typ:'email_verification'},{secret,issuer:'aiva-iot',audience:'aiva-email-verification',expiresIn:60});
  expect(await service.verifyEmail(token)).toEqual({success:true});expect(repo.verifyEmail).toHaveBeenCalledWith('7');
 });
 it.each(['access','refresh','expired','tampered'])('does not verify an account with %s proof',async kind=>{
  const repo={verifyEmail:jest.fn()};const service=new AuthService(repo as any,{} as any,jwt,config);
  let token=await jwt.signAsync({sub:'7',typ:kind==='access'?'access':kind==='refresh'?'refresh':'email_verification'},
   {secret,issuer:'aiva-iot',audience:kind==='access'?'aiva-api':kind==='refresh'?'aiva-refresh':'aiva-email-verification',expiresIn:kind==='expired'?-1:60});
  if(kind==='tampered')token+='x';
  await expect(service.verifyEmail(token)).rejects.toMatchObject({status:400});expect(repo.verifyEmail).not.toHaveBeenCalled();
 });
});
