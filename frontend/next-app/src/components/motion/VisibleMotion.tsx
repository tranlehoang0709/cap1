'use client';
import {useEffect,useRef} from 'react';

export function useVisibleMotion<T extends HTMLElement>(){
 const ref=useRef<T>(null);
 useEffect(()=>{
  const node=ref.current;if(!node)return;let visible=false;
  const sync=()=>{node.dataset.motionVisible=String(visible&&!document.hidden);};
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;sync();},{threshold:.01});
  observer.observe(node);document.addEventListener('visibilitychange',sync);sync();
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',sync);};
 },[]);
 return ref;
}
export function LoadingSkeleton(){const ref=useVisibleMotion<HTMLDivElement>();return <div ref={ref} className="skeleton-wrap" data-motion-visible="false" aria-label="Đang tải" role="status"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div>;}
export function Spinner(){const ref=useVisibleMotion<HTMLSpanElement>();return <span ref={ref} className="spinner" data-motion-visible="false" aria-hidden="true"/>;}
