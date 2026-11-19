'use client';
import {memo,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {useNovaInteractions} from '@/components/robot/NovaInteractionProvider';
/* Lossless images compile the original SVG paths/points/filters at desktop/retina/mobile
   resolution. The browser composites cached pixels instead of rerasterizing SVG. */
const BackgroundPalette=memo(function BackgroundPalette({theme,active}:{theme:'dark'|'light';active:boolean}){
 const priority=active?'high':'low';
 const meshSrcSet=active?`/backgrounds/mesh-${theme}.webp 1x, /backgrounds/mesh-${theme}@2x.webp 2x`:`/backgrounds/mesh-${theme}.webp 1x`;
 const wavesSrcSet=active?`/backgrounds/waves-${theme}.webp 1x, /backgrounds/waves-${theme}@2x.webp 2x`:`/backgrounds/waves-${theme}.webp 1x`;
 return <div className={`living-theme living-theme-${theme}`}>
 <div className="living-atmosphere" data-layer="atmosphere"/><div className="living-parallax">
  <div className="living-lighting" data-layer="lighting"><div className="ambient-halo nova-halo"/><div className="ambient-halo form-halo"/><div className="living-connection"/></div>
  <picture className="living-mesh" data-layer="mesh"><source media="(max-width:700px)" srcSet={`/backgrounds/mesh-${theme}-mobile.webp`}/><img src={`/backgrounds/mesh-${theme}.webp`} srcSet={meshSrcSet} fetchPriority={priority} alt="" draggable={false} width={1600} height={900} decoding="async"/></picture>
  <div className="living-waves" data-layer="waves"><picture><source media="(max-width:700px)" srcSet={`/backgrounds/waves-${theme}-mobile.webp`}/><img src={`/backgrounds/waves-${theme}.webp`} srcSet={wavesSrcSet} fetchPriority={priority} alt="" draggable={false} width={1600} height={900} decoding="async"/></picture></div>
 </div><div className="living-vignette"/>
 </div>;});

/** Decorative CSS/SVG only. No renderer, animation frame or React pointer state. */
export function LivingBackground(){
 const host=useRef<HTMLDivElement>(null);
 const id=useId();
 const interactions=useNovaInteractions();
 const mode=useSyncExternalStore(interactions.subscribe,interactions.getSnapshot,interactions.getSnapshot).mode;
 const [activeTheme,setActiveTheme]=useState<'dark'|'light'>('dark');
 useEffect(()=>{
  const root=document.documentElement;
  const syncTheme=()=>{setActiveTheme(root.classList.contains('light')?'light':'dark');};
  syncTheme();
  const observer=new MutationObserver(syncTheme);
  observer.observe(root,{attributes:true,attributeFilter:['class']});
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{for(const wave of host.current?.querySelectorAll('.living-waves')||[])for(const animation of wave.getAnimations())animation.updatePlaybackRate(mode==='thinking'?.55:1);},[mode]);
 useEffect(()=>{
  const element=host.current;if(!element)return;const parallax=element.querySelectorAll<HTMLElement>('.living-parallax');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const fine=matchMedia('(pointer: fine) and (min-width: 769px)');
  let engaged=false;
  const field=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select');
  function sync(){element!.dataset.running=String(!document.hidden&&!reduce.matches&&!engaged);if(reduce.matches||!fine.matches||engaged)for(const node of parallax)node.style.transform='translate3d(0px,0px,0)';}
  function handleBackgroundPointer(event:PointerEvent){if(reduce.matches||!fine.matches||document.hidden||engaged)return;const transform=`translate3d(${((event.clientX/innerWidth)-.5)*12}px,${((event.clientY/innerHeight)-.5)*10}px,0)`;for(const node of parallax)node.style.transform=transform;}
  function focusIn(event:FocusEvent){engaged=field(event.target);sync();}
  function focusOut(event:FocusEvent){engaged=field(event.relatedTarget);sync();}
  window.addEventListener('pointermove',handleBackgroundPointer,{passive:true});
  document.addEventListener('visibilitychange',sync);
  document.addEventListener('focusin',focusIn);document.addEventListener('focusout',focusOut);
  reduce.addEventListener('change',sync);fine.addEventListener('change',sync);sync();
  document.dispatchEvent(new CustomEvent('aiva-background:mounted',{detail:{id,variant:'living'}}));
  return()=>{window.removeEventListener('pointermove',handleBackgroundPointer);document.removeEventListener('visibilitychange',sync);document.removeEventListener('focusin',focusIn);document.removeEventListener('focusout',focusOut);reduce.removeEventListener('change',sync);fine.removeEventListener('change',sync);document.dispatchEvent(new CustomEvent('aiva-background:disposed',{detail:{id,variant:'living'}}));};
 },[id]);
 return <div ref={host} className="aiva-background living-background" data-background="living" data-running="false" data-nova-mode={mode} aria-hidden="true">
  <BackgroundPalette theme="dark" active={activeTheme==='dark'}/><BackgroundPalette theme="light" active={activeTheme==='light'}/>
 </div>;
}
