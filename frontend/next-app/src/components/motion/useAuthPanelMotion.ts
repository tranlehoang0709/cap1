'use client';
import {useCallback,useEffect,useRef} from 'react';
type Box={top:number;height:number};
type Flight={from:Box;to:Box;animation:Animation};

export function cssTimeMilliseconds(value:string){
 const match=/^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
 return match?Number(match[1])*(match[2]==='s'?1000:1):200;
}

/** Local, interruptible FLIP. ResizeObserver reads already-laid-out geometry;
 * clicks only sample animation timing, never force a theme/layout flush. */
export function useAuthPanelMotion(enabled=true){
 const ref=useRef<HTMLDivElement>(null),settled=useRef<Box|null>(null),previous=useRef<Box|null>(null),flight=useRef<Flight|null>(null),animations=useRef<Animation[]>([]),observerRef=useRef<ResizeObserver|null>(null);
 const cancel=useCallback(()=>{const active=animations.current;animations.current=[];flight.current=null;for(const animation of active)animation.cancel();if(ref.current)ref.current.dataset.authMotion='idle';},[]);
 const capture=useCallback((pointer:boolean)=>{
  const node=ref.current;
  if(!enabled||!node||!pointer||matchMedia('(prefers-reduced-motion: reduce)').matches){previous.current=null;cancel();return;}
  const current=flight.current,progress=current?.animation.effect?.getComputedTiming().progress??1;
  const from=current?{top:current.from.top+(current.to.top-current.from.top)*progress,height:current.from.height+(current.to.height-current.from.height)*progress}:settled.current;
  cancel();previous.current=from;if(from)node.dataset.authMotion='pending';
  // Re-observe guarantees delivery even if several requests coalesce to the
  // original size before layout. A size-only subscription could stay pending.
  observerRef.current?.unobserve(node);observerRef.current?.observe(node,{box:'border-box'});
 },[cancel,enabled]);
 useEffect(()=>{
  const node=ref.current;if(!node||!enabled){previous.current=null;settled.current=null;cancel();return;}
  const surface=node.querySelector<HTMLElement>('.auth-card-surface')!,styles=getComputedStyle(node);
  // Production CSS can minify 200ms to .2s; parseFloat alone makes it .2ms.
  const options={duration:cssTimeMilliseconds(styles.getPropertyValue('--motion-state')),easing:styles.getPropertyValue('--ease-out').trim()};
  const observer=new ResizeObserver(()=>{
   // Observer delivery follows layout; this read doesn't flush pending React DOM.
   const from=previous.current;previous.current=null;cancel();
   const rect=node.getBoundingClientRect(),to={top:rect.top+scrollY,height:rect.height};settled.current=to;
   if(!from||!node.animate)return;
   // Keep inputs/tab hit targets and the backdrop sample stationary. Only the
   // cached glass/tint/border surface morphs; no transformed backdrop-filter.
   const resizing=surface.animate([{transform:`translateY(${from.top-to.top}px) scaleY(${from.height/to.height})`},{transform:'translateY(0) scaleY(1)'}],options);
   resizing.id='aiva-auth-surface';
   const active=[resizing];animations.current=active;flight.current={from,to,animation:resizing};node.dataset.authMotion='running';
   void Promise.all(active.map(animation=>animation.finished)).then(()=>{if(animations.current===active){animations.current=[];flight.current=null;node.dataset.authMotion='idle';}}).catch(()=>{});
  });observerRef.current=observer;observer.observe(node,{box:'border-box'});
  const media=matchMedia('(prefers-reduced-motion: reduce)'),reset=()=>{previous.current=null;cancel();};
  const visibility=()=>{if(document.hidden)reset();};
  window.addEventListener('resize',reset,{passive:true});media.addEventListener('change',reset);
  document.addEventListener('visibilitychange',visibility);
  return()=>{observer.disconnect();observerRef.current=null;window.removeEventListener('resize',reset);media.removeEventListener('change',reset);document.removeEventListener('visibilitychange',visibility);cancel();};
 },[cancel,enabled]);
 return {ref,capture};
}
