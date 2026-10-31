import { BadRequestException } from '@nestjs/common';
import { deviceId } from '../devices/dto/device-query.dto';

export type Scope='USER'|'SYSTEM';
export interface Owner {scope:Scope;userId:string|null}
export const profileFields=['assistantName','systemPrompt','preferredProviderId','preferredLlmModelId','languageCode','voiceCode'] as const;
export interface Profile {assistantName:string|null;systemPrompt:string|null;preferredProviderId:string|null;
  preferredLlmModelId:string|null;languageCode:string|null;voiceCode:string|null}
export const emptyProfile:Profile={assistantName:null,systemPrompt:null,preferredProviderId:null,preferredLlmModelId:null,languageCode:null,voiceCode:null};
export function objectInput(body:unknown,fields:readonly string[],required=false):Record<string,unknown>{
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k))
    ||(required&&!Object.keys(body).length))throw new BadRequestException('Invalid body fields');
  return body as Record<string,unknown>;
}
export function id(value:unknown):string{return deviceId(value);}
export function text(value:unknown,max:number,nullable=false,multiline=false):string|null{
  if(nullable&&value===null)return null;
  if(typeof value!=='string'||[...value].length>max||!value.trim()
    ||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))throw new BadRequestException('Invalid text value');
  return value.trim();
}
export function secretInput(value:unknown):string{
  if(typeof value!=='string'||value.length<16||value.length>8192||/[^\x21-\x7e]/.test(value))throw new BadRequestException('Invalid secret format');
  return value;
}
export function profileInput(body:unknown):Partial<Profile>&{credentialScope?:Scope}{
  const input=objectInput(body,[...profileFields,'credentialScope'],true);const result:Partial<Profile>&{credentialScope?:Scope}={};
  for(const key of profileFields){
    if(input[key]===undefined)continue;
    if(key==='preferredProviderId'||key==='preferredLlmModelId')result[key]=input[key]===null?null:id(input[key]);
    else result[key]=text(input[key],{assistantName:100,systemPrompt:16000,languageCode:20,voiceCode:100}[key],true,key==='systemPrompt');
  }
  if(input.credentialScope!==undefined){
    if(!['USER','SYSTEM'].includes(input.credentialScope as string))throw new BadRequestException('Invalid credentialScope');
    result.credentialScope=input.credentialScope as Scope;
  }
  return result;
}
