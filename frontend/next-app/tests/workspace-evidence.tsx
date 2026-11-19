// Test-only isolated component fixture. Does not establish or imitate a session.
import {renderToStaticMarkup} from 'react-dom/server';
import {ThemeProvider} from 'next-themes';
import type {AivaTheme} from '../src/lib/theme-policy';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {AppShell} from '../src/components/app-shell';
import {Workspace} from '../src/components/workspace';
const unavailable=()=>{throw new Error('Isolated SSR evidence has no router or authenticated session');};
const router={back:unavailable,forward:unavailable,refresh:unavailable,push:unavailable,replace:unavailable,prefetch:unavailable,bfcacheId:'isolated-component'};
export function workspaceEvidence(admin:boolean,section='dashboard',theme:AivaTheme='dark'){
 const role=admin?'ADMIN':'USER';
 return renderToStaticMarkup(<ThemeProvider attribute="class" forcedTheme={theme} enableSystem={false} themes={['light','dark']}><AppRouterContext.Provider value={router}><PathnameContext.Provider value={`/${admin?'admin':'user'}/${section}`}><AppShell user={{id:'1',role,display_name:'Kiểm thử component',email:'component@example.invalid'}}><Workspace section={section} admin={admin}/></AppShell></PathnameContext.Provider></AppRouterContext.Provider></ThemeProvider>);
}
