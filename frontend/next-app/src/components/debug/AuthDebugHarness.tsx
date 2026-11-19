'use client';
import {useState,type ReactNode} from 'react';
import './auth-debug.css';

export type AuthDebugFlags={nova:boolean;background:boolean;glass:boolean;form:boolean};
const all:AuthDebugFlags={nova:true,background:true,glass:true,form:true};
const presets:Record<string,AuthDebugFlags>={A:all,B:{...all,nova:false},C:{...all,background:false},D:{...all,glass:false},E:{...all,form:false},F:{...all,nova:false,background:false}};
const presetLabels:Record<string,string>={A:'Tất cả bật',B:'Tắt NOVA',C:'Tắt nền',D:'Tắt Glass/Blur',E:'Tắt Form transitions',F:'Tắt NOVA và nền'};
const labels:Record<keyof AuthDebugFlags,string>={nova:'NOVA Three.js',background:'Living Background',glass:'Glass / blur UI',form:'Form transitions'};
const parameters:Record<keyof AuthDebugFlags,string>={nova:'debugNova',background:'debugBackground',glass:'debugGlass',form:'debugForm'};

function initial(){
 const query=new URLSearchParams(window.location.search),active=query.get('authDebug')==='1';
 const flags={...(presets[query.get('debugCase')||'A']||all)};
 for(const key of Object.keys(parameters) as (keyof AuthDebugFlags)[]){const value=query.get(parameters[key]);if(value==='0'||value==='1')flags[key]=value==='1';}
 return {active,flags};
}

/** Loaded through a compile-time development branch; never a production control. */
export default function AuthDebugHarness({children}:{children:(flags?:AuthDebugFlags)=>ReactNode}){
 const [state,setState]=useState(initial);
 if(process.env.NODE_ENV!=='development')return children();
 function apply(flags:AuthDebugFlags,preset?:string){
  setState({active:true,flags});const url=new URL(window.location.href);url.searchParams.set('authDebug','1');
  if(preset)url.searchParams.set('debugCase',preset);else url.searchParams.delete('debugCase');
  for(const key of Object.keys(parameters) as (keyof AuthDebugFlags)[])url.searchParams.set(parameters[key],flags[key]?'1':'0');
  window.history.replaceState(window.history.state,'',url);
 }
 return <>{children(state.active?state.flags:undefined)}{state.active&&<details className="auth-debug-panel" data-auth-debug-panel open>
  <summary>DEV · Phân lập khựng</summary>
  <div className="auth-debug-controls" data-auth-debug-ready="true">
   <p>Tắt = dừng tác vụ, không chỉ che hình. Thu gọn bảng trước khi so sánh.</p>
   {(Object.keys(labels) as (keyof AuthDebugFlags)[]).map(key=><button key={key} type="button" role="switch" aria-checked={state.flags[key]} data-debug-switch={key} onClick={()=>apply({...state.flags,[key]:!state.flags[key]})}><span>{labels[key]}</span><strong>{state.flags[key]?'BẬT':'TẮT'}</strong></button>)}
   <div className="auth-debug-presets" aria-label="Cấu hình phân lập">{Object.keys(presets).map(id=><button key={id} type="button" data-debug-preset={id} title={presetLabels[id]} onClick={()=>apply({...presets[id]},id)}>{id}</button>)}</div>
   <p>A: tất cả · B: −NOVA · C: −nền · D: −Glass · E: −Form · F: −NOVA/nền</p>
   <p>Glass bỏ blur/filter, shadow và nền trong suốt của UI. Glow đã dựng sẵn trong ảnh sóng thuộc công tắc nền. Auth hiện dùng WAAPI, không dùng native View Transition.</p>
  </div>
 </details>}</>;
}
