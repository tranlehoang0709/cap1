import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {renderToStaticMarkup} from 'react-dom/server';
import {ThemeProvider} from 'next-themes';
import {ThemeToggle} from '../src/components/theme-toggle';
import {normalizeTheme,DEFAULT_THEME,AIVA_THEMES,themeBootstrap} from '../src/lib/theme-policy';
import {createDigitalMesh} from '../src/components/backgrounds/living-geometry';

function bootstrap(saved:string|null,blocked=false){const classes=new Set(['system','light']);let stored=saved;const style:{colorScheme?:string}={};const storage={getItem:()=>{if(blocked)throw new Error('unavailable');return stored;},setItem:(_key:string,value:string)=>{if(blocked)throw new Error('unavailable');stored=value;}};runInNewContext(themeBootstrap,{localStorage:storage,document:{documentElement:{classList:{remove:(...keys:string[])=>keys.forEach(k=>classes.delete(k)),add:(key:string)=>classes.add(key)},style}}});return {classes:[...classes],stored,colorScheme:style.colorScheme};}
test('theme bootstrap defaults to dark, migrates legacy/invalid values and retains light',()=>{
 assert.equal(DEFAULT_THEME,'dark');assert.deepEqual(AIVA_THEMES,['light','dark']);
 for(const saved of [null,'system','unknown','dark','']){const r=bootstrap(saved);assert.deepEqual(r.classes,['dark']);assert.equal(r.stored,'dark');assert.equal(r.colorScheme,'dark');}
 const light=bootstrap('light');assert.deepEqual(light.classes,['light']);assert.equal(light.stored,'light');assert.equal(normalizeTheme(undefined),'dark');
});
test('theme bootstrap works with unavailable storage and is idempotent',()=>{assert.deepEqual(bootstrap(null,true).classes,['dark']);assert.deepEqual(bootstrap(bootstrap('system').stored),bootstrap('dark'));});
test('theme toggle SSR has one button, current icon/label, no dropdown or system option',()=>{
 for(const mode of ['light','dark']){const html=renderToStaticMarkup(<ThemeProvider forcedTheme={mode} enableSystem={false} themes={AIVA_THEMES}><ThemeToggle/></ThemeProvider>);assert.equal((html.match(/<button/g)||[]).length,1);assert.ok(!/<select|<option/.test(html));assert.ok(html.includes(`data-theme-mode="${mode}"`));assert.ok(html.includes(mode==='dark'?'lucide-moon':'lucide-sun'));assert.ok(html.includes(mode==='dark'?'>Tối<':'>Sáng<'));}
});
test('digital mesh is deterministic, finite and restricted to the lower wave surface',()=>{const a=createDigitalMesh();assert.deepEqual(a,createDigitalMesh());assert.ok(a.length>=900&&a.length<=1600);assert.ok(a.every(p=>Object.values(p).every(Number.isFinite)&&p.y>500&&p.r>0&&p.r<1.1&&p.opacity>0&&p.opacity<=1));});
