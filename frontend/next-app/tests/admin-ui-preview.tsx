// Isolated presentation check, never a successful-auth fixture or product route.
// No backend records, KPI values, cookies, JWTs or credentials are supplied.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from 'next-themes';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {AppShell} from '../src/components/app-shell';
import {AdminDashboardView} from '../src/components/admin/AdminDashboard';
import '../src/app/globals.css';
import '../src/app/aiva-backgrounds.css';
import '../src/app/aiva-workspace.css';
import '../src/app/aiva-motion.css';
import '../src/components/admin/admin-workspace.css';

declare global {interface Window {adminUI:{state:(value:'loading'|'error'|'empty')=>void;reloads:number;navigation:string[]}}}
function Preview(){
 const [mode,setMode]=useState<'loading'|'error'|'empty'>('empty');
 const [path,setPath]=useState('/admin/dashboard');
 useEffect(()=>{window.adminUI={state:setMode,reloads:0,navigation:[]};},[]);
 const navigate=(href:string)=>{window.adminUI.navigation.push(href);setPath(href);};
 const router={back:()=>{},forward:()=>{},refresh:()=>{},push:navigate,replace:navigate,prefetch:()=>{},bfcacheId:'isolated-admin-ui'};
 const reload=()=>{window.adminUI.reloads++;};
 const resource={data:undefined,loading:mode==='loading',error:mode==='error'?'Không kết nối được Backend.':undefined,reload};
 return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={['dark','light']}>
  <AppRouterContext value={router}><PathnameContext value={path}>
   <div onClickCapture={event=>{const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href]');if(anchor?.getAttribute('href')?.startsWith('/admin/')){event.preventDefault();navigate(anchor.getAttribute('href')!);}}}>
   <AppShell user={{id:'',role:'ADMIN',display_name:'Chưa có phiên Admin',email:''}}>
    <AdminDashboardView state={resource} history={{...resource,data:[]}} data={{}}/>
   </AppShell></div>
  </PathnameContext></AppRouterContext>
  <div style={{position:'fixed',bottom:4,left:4,zIndex:100,fontSize:9,background:'var(--card)',color:'var(--muted)',border:'1px solid var(--border)',padding:'3px 7px',borderRadius:4,pointerEvents:'none'}}>COMPONENT PREVIEW · Không có phiên Admin · Không có dữ liệu nghiệp vụ</div>
 </ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
