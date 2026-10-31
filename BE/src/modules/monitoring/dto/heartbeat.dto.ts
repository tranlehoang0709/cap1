import { BadRequestException } from '@nestjs/common';
import { authorizationInput } from '../../devices/dto/ownership.dto';

export interface HeartbeatEvent {
  deviceUid:string;credential:string;observedAt:Date;
  telemetry?:{wifiRssi:number|null;freeHeapBytes:string|null;batteryPercent:number|null;payload:Record<string,unknown>|null};
}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Invalid heartbeat object');
  return value as Record<string,unknown>;
}
export function heartbeatInput(body:unknown):HeartbeatEvent{
  const input=object(body);
  if(Object.keys(input).some(k=>!['deviceUid','credential','observedAt','telemetry'].includes(k)))throw new BadRequestException('Unknown heartbeat field');
  const identity=authorizationInput({deviceUid:input.deviceUid,credential:input.credential});
  // DATETIME in the running schema has whole-second resolution. No lossy truncation.
  if(typeof input.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(input.observedAt))throw new BadRequestException('observedAt must be UTC ISO time at whole-second precision');
  const observedAt=new Date(input.observedAt);
  if(!Number.isFinite(observedAt.getTime())||observedAt.toISOString()!==input.observedAt.replace(/Z$/,input.observedAt.includes('.')?'Z':'.000Z'))throw new BadRequestException('Invalid observedAt');
  const result:HeartbeatEvent={...identity,observedAt};
  if(input.telemetry===undefined)return result;
  const data=object(input.telemetry);
  if(Object.keys(data).some(k=>!['wifiRssi','freeHeapBytes','batteryPercent','payload'].includes(k)))throw new BadRequestException('Unknown telemetry field');
  function integer(name:string,min:number,max:number):number|null{
    const v=data[name];if(v===undefined||v===null)return null;
    if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw new BadRequestException(`Invalid ${name}`);
    return v;
  }
  const wifiRssi=integer('wifiRssi',-127,0);const batteryPercent=integer('batteryPercent',0,100);
  let freeHeapBytes:string|null=null;
  if(data.freeHeapBytes!==undefined&&data.freeHeapBytes!==null){
    const value=data.freeHeapBytes;
    if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))
      ||!/^(0|[1-9]\d{0,18})$/.test(String(value))||BigInt(value)>9223372036854775807n)throw new BadRequestException('Invalid freeHeapBytes');
    freeHeapBytes=String(value);
  }
  let payload:Record<string,unknown>|null=null;
  if(data.payload!==undefined){
    const p=object(data.payload);
    if(Object.keys(p).some(k=>!['uptimeSeconds','firmwareVersion'].includes(k)))throw new BadRequestException('Unsupported telemetry payload');
    if(p.uptimeSeconds!==undefined&&(typeof p.uptimeSeconds!=='number'||!Number.isSafeInteger(p.uptimeSeconds)||p.uptimeSeconds<0))throw new BadRequestException('Invalid uptimeSeconds');
    if(p.firmwareVersion!==undefined&&(typeof p.firmwareVersion!=='string'||!p.firmwareVersion||[...p.firmwareVersion].length>100||/[\u0000-\u001f\u007f]/.test(p.firmwareVersion)))throw new BadRequestException('Invalid firmwareVersion');
    if(Object.keys(p).length)payload={...p};
  }
  if(wifiRssi!==null||freeHeapBytes!==null||batteryPercent!==null||payload!==null)result.telemetry={wifiRssi,freeHeapBytes,batteryPercent,payload};
  return result;
}
