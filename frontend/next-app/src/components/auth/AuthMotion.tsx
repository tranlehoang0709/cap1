'use client';

import {createContext,useContext,useSyncExternalStore,type ReactNode} from 'react';
import {AnimatePresence,MotionConfig,motion,useReducedMotion} from 'motion/react';
import {useTheme} from 'next-themes';
import {Moon,Sun} from 'lucide-react';
import {DEFAULT_THEME,normalizeTheme} from '@/lib/theme-policy';

// Animate UI skill, custom-markup path: existing Motion 12, no global upgrade.
// Shared recipe tokens; omit blur intentionally on the already glass-heavy Auth.
export const authPress={type:'spring',stiffness:550,damping:30,restSpeed:10} as const;
const selection={type:'spring',stiffness:300,damping:30} as const;
const swap={duration:.15,ease:[.23,1,.32,1]} as const;
const Enabled=createContext(true);
export function AuthMotion({enabled,children}:{enabled:boolean;children:ReactNode}){
 return <Enabled value={enabled}><MotionConfig reducedMotion="user">{children}</MotionConfig></Enabled>;
}
export function useAuthMotion(){const enabled=useContext(Enabled);const reduced=useReducedMotion();return enabled&&!reduced;}

// Content container lets useAuthPanelMotion drive the single 200ms surface FLIP
// without per-frame spring height resizing cancelling the surface animation.
export function AuthAutoHeight({children}:{children:ReactNode}){
 return <div className="auth-height"><div className="auth-height-content">{children}</div></div>;
}

export function AuthTabHighlight({index}:{index:number}){
 const enabled=useAuthMotion();
 return <motion.span aria-hidden="true" className="auth-tab-highlight" initial={false} animate={{x:`${index*100}%`}} transition={enabled?selection:{duration:0}}/>;
}
export function AuthPanel({children}:{children:ReactNode}){
 const enabled=useAuthMotion();
 return <motion.div initial={enabled?{opacity:0,x:12}:false} animate={{opacity:1,x:0}} transition={enabled?{duration:.3,ease:[.25,.1,.35,1]}:{duration:0}}>{children}</motion.div>;
}
export function AuthFeedback({text,kind}:{text:string;kind:'error'|'success'}){
 const enabled=useAuthMotion();
 return <motion.div className={`alert ${kind}`} role={kind==='error'?'alert':'status'} initial={enabled?{opacity:0}:false} animate={{opacity:1}} transition={enabled?swap:{duration:0}}>{text}</motion.div>;
}
export function AuthButtonLabel({busy,children}:{busy:boolean;children:ReactNode}){
 const enabled=useAuthMotion();
 return <span className="auth-button-label"><AnimatePresence initial={false} mode="popLayout"><motion.span key={String(busy)} className="auth-button-copy" initial={enabled?{opacity:0}:false} animate={{opacity:1}} exit={{opacity:0,transition:enabled?swap:{duration:0}}} transition={enabled?swap:{duration:0}}>{children}</motion.span></AnimatePresence></span>;
}

// Auth-only visual swap. The shared dashboard toggle is untouched.
const subscribe=()=>()=>{},clientSnapshot=()=>true,serverSnapshot=()=>false;
export function AuthThemeToggle(){
 const {theme,forcedTheme,setTheme}=useTheme(),enabled=useAuthMotion();
 const mounted=useSyncExternalStore(subscribe,clientSnapshot,serverSnapshot);
 const current=normalizeTheme(forcedTheme||(mounted?theme:DEFAULT_THEME)),dark=current==='dark';
 return <button type="button" className="theme-toggle" aria-label="Đổi giao diện Sáng/Tối" aria-pressed={dark} data-theme-toggle data-theme-mode={current} data-hydrated={mounted} title={dark?'Chuyển sang Sáng':'Chuyển sang Tối'} onClick={()=>setTheme(dark?'light':'dark')}>
  <span className="auth-theme-icon"><motion.span key={current} initial={enabled?{opacity:0,scale:.5}:false} animate={{opacity:1,scale:1}} transition={enabled?swap:{duration:0}}>{dark?<Moon size={17} aria-hidden="true"/>:<Sun size={17} aria-hidden="true"/>}</motion.span></span><span>{dark?'Tối':'Sáng'}</span>
 </button>;
}
