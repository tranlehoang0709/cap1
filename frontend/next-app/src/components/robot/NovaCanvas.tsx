'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useTheme} from 'next-themes';
import {Volume2,VolumeX} from 'lucide-react';
import {createStage,type NovaStage} from './engine/scene.js';
import {NovaAudio} from './engine/audio.js';
import {useNovaInteractions} from './NovaInteractionProvider';
import styles from './nova.module.css';
type Audio=InstanceType<typeof NovaAudio>;
const reducedQuery='(prefers-reduced-motion: reduce)';
const subscribeReduced=(listener:()=>void)=>{const media=matchMedia(reducedQuery);media.addEventListener('change',listener);return()=>media.removeEventListener('change',listener);};
const getReduced=()=>matchMedia(reducedQuery).matches;
const serverReduced=()=>false;
export default function NovaCanvas({enableBeastMode=true,compact=false}:{enableBeastMode?:boolean;compact?:boolean}={}){
 const reduced=useSyncExternalStore(subscribeReduced,getReduced,serverReduced);
 const host=useRef<HTMLDivElement>(null),stage=useRef<NovaStage|null>(null),audio=useRef<Audio|null>(null),alive=useRef(false);
 const interactions=useNovaInteractions();const smart=useSyncExternalStore(interactions.subscribe,interactions.getSnapshot,interactions.getSnapshot);
 const {resolvedTheme}=useTheme();const theme=useRef(resolvedTheme);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[sound,setSound]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{theme.current=resolvedTheme;stage.current?.setTheme(resolvedTheme==='light');},[resolvedTheme]);
 useEffect(()=>{
  const element=host.current;if(!element)return;let active=true;alive.current=true;let current:NovaStage|null=null;const voice=new NovaAudio();audio.current=voice;
  let previousAction='';
  const apply=()=>{if(!current||current.snapshot().disposed)return;const output=interactions.getSnapshot();current.setInteraction(output.mode);current.setBeast(enableBeastMode&&output.beast);current.controller.tracking=output.tracking;current.controller.emotion=output.emotion;if(previousAction!==output.action){current.trigger(output.action);previousAction=output.action;if(output.action!=='idle')voice.play(output.action);else voice.stop();}};
  try{current=createStage(element,{embedded:true,onFrame:dt=>interactions.tick(dt),onInteract:()=>interactions.send({type:'interact'}),onReaction:()=>interactions.send({type:'robot-click'}),onReady:()=>{if(active){setReady(true);element.dispatchEvent(new CustomEvent('aiva-nova:ready',{bubbles:true,detail:{snapshot:()=>({...current?.snapshot(),smart:interactions.getSnapshot(),audio:{enabled:voice.enabled,state:voice.context?.state||'uninitialized',voices:voice.voices.size,played:voice.played}})}}));}},onError:()=>{if(active){setReady(false);setError('NOVA chưa thể hiển thị. Bạn vẫn có thể đăng nhập bình thường.');}void voice.dispose();}});current.setTheme(theme.current==='light');stage.current=current;apply();}
  catch{queueMicrotask(()=>{if(active)setError('WebGL chưa khả dụng. Bạn vẫn có thể sử dụng form đăng nhập.');});void voice.dispose();element.querySelector('canvas')?.remove();}
  const unsubscribe=interactions.subscribe(apply);
  const visibility=()=>{if(document.hidden)void voice.suspend();else if(!current?.controller.paused)void voice.resume();};document.addEventListener('visibilitychange',visibility);
  return()=>{active=false;alive.current=false;unsubscribe();document.removeEventListener('visibilitychange',visibility);current?.dispose();const released=current?.snapshot();void voice.dispose().then(()=>document.dispatchEvent(new CustomEvent('aiva-nova:disposed',{detail:{...released,audioState:voice.context?.state||'uninitialized'}})));if(stage.current===current)stage.current=null;if(audio.current===voice)audio.current=null;};
 },[interactions,enableBeastMode]);
 async function toggleSound(){const value=!sound;try{await audio.current?.enable(value);if(stage.current?.controller.paused)await audio.current?.suspend();if(!alive.current)return;setSound(value);setNotice(value?'Âm thanh đã bật.':'Âm thanh đã tắt.');}catch{if(alive.current)setNotice('Chưa bật được âm thanh.');}}
 return <div className={`${styles.content}${compact?' '+styles.companion:''}`} data-nova-status={ready&&!error?'ready':error?'error':'loading'} data-smart-mode={smart.mode} data-beast-mode={enableBeastMode&&!reduced&&smart.beast?'beast':'normal'}>
  <div className={styles.viewport} ref={host}>{!ready&&!error&&<p className={styles.loading} role="status">Đang khởi tạo NOVA…</p>}</div>
  {error?<p className={styles.error} role="alert">{error}</p>:<div className={styles.status}><p className={styles.caption}>{smart.caption}</p><span className="sr-only" aria-live="polite" aria-atomic="true">{['thinking','success','sad','worried','confused'].includes(smart.mode)?smart.caption:''}</span><button className={styles.sound} type="button" disabled={!ready} aria-label={sound?'Tắt âm thanh NOVA':'Bật âm thanh NOVA'} title={sound?'Tắt âm thanh NOVA':'Bật âm thanh NOVA'} aria-pressed={sound} onClick={toggleSound}>{sound?<Volume2 size={16}/>:<VolumeX size={16}/>}</button></div>}
  {notice&&<p className="sr-only" role="status">{notice}</p>}
 </div>;
}
