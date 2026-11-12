'use client';
import {useSyncExternalStore} from 'react';
import {useTheme} from 'next-themes';
import {Moon,Sun} from 'lucide-react';
import {DEFAULT_THEME,normalizeTheme} from '@/lib/theme-policy';

const subscribe=()=>()=>{};
const clientSnapshot=()=>true;
const serverSnapshot=()=>false;

export function ThemeToggle(){
 const {theme,forcedTheme,setTheme}=useTheme();
 const mounted=useSyncExternalStore(subscribe,clientSnapshot,serverSnapshot);
 const current=normalizeTheme(forcedTheme||(mounted?theme:DEFAULT_THEME));
 const dark=current==='dark';
 return <button type="button" className="theme-toggle" aria-label="Đổi giao diện Sáng/Tối" aria-pressed={dark} data-theme-toggle data-theme-mode={current} data-hydrated={mounted} title={dark?'Chuyển sang Sáng':'Chuyển sang Tối'} onClick={()=>setTheme(dark?'light':'dark')}>
  {dark?<Moon size={17} aria-hidden="true"/>:<Sun size={17} aria-hidden="true"/>}<span>{dark?'Tối':'Sáng'}</span>
 </button>;
}
