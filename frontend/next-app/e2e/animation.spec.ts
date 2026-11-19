import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {selectTheme} from './theme-helpers';
declare global{interface Window{__vtStarts?:number;__vtReady?:number;__vtNames?:string[];__vtErrors?:string[];__authStarts?:number;__slowAuth?:boolean;__authDurations?:number[]}}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{
 document.addEventListener('aiva-nova:ready',event=>{window.__nova=(event as CustomEvent).detail.snapshot;});
 window.__vtStarts=0;window.__vtReady=0;window.__vtNames=[];window.__vtErrors=[];
 window.__authStarts=0;window.__authDurations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const auth=this.matches('.auth-form,.auth-card-surface');if(auth){window.__authStarts!++;window.__authDurations!.push(typeof options==='object'?Number(options.duration):Number(options));}const config=auth&&window.__slowAuth&&typeof options==='object'?{...options,duration:Number(options.duration)*5}:options;return animate.call(this,frames,config);};
 if(document.startViewTransition){const start=document.startViewTransition.bind(document);document.startViewTransition=(...args:Parameters<Document['startViewTransition']>)=>{window.__vtStarts!++;const result=start(...args);result.ready.then(()=>{window.__vtReady!++;window.__vtNames=document.getAnimations().map(a=>a instanceof CSSAnimation?a.animationName:'other');}).catch(e=>window.__vtErrors!.push(String(e)));return result;};}
 });});
async function ready(page:Page){await page.goto('/login');await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});}

test('auth tabs use interruptible local motion and retain the live canvas',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);const canvas=await page.locator('canvas').elementHandle();const before=await page.evaluate(()=>window.__nova!().frames);
 // Slow only this feel/interruptibility test, never the production performance samples.
 await page.evaluate(()=>window.__slowAuth=true);
 await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await expect(page.getByLabel('Nhập lại mật khẩu',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__authStarts)).toBeGreaterThan(0);expect(await page.evaluate(()=>window.__authDurations)).toContain(200);expect(await page.evaluate(()=>document.getAnimations().map(a=>a.id))).toContain('aiva-auth-surface');
 // Real mouse events while the previous 200 ms animation is still active.
 for(const tab of ['Đăng nhập','Đăng ký']){await page.waitForTimeout(60);await page.getByRole('tab',{name:tab,exact:true}).click({force:true});await expect(page.getByRole('tab',{name:tab,exact:true})).toHaveAttribute('aria-selected','true');}
 await expect(page.locator('.auth-form')).toHaveAttribute('data-auth-motion','idle');await page.evaluate(()=>window.__slowAuth=false);
 // Repeat real pointer clicks at the unmodified production duration as well.
 for(const tab of ['Đăng nhập','Đăng ký','Đăng nhập']){await page.getByRole('tab',{name:tab,exact:true}).click({force:true});await expect(page.getByRole('tab',{name:tab,exact:true})).toHaveAttribute('aria-selected','true');await page.waitForTimeout(60);}
 await expect(page.locator('.auth-form')).toHaveAttribute('data-auth-motion','idle');expect(await page.evaluate(()=>window.__vtStarts)).toBe(0);expect(await canvas?.evaluate(el=>el.isConnected)).toBe(true);expect(await page.evaluate(()=>window.__nova!().frames)).toBeGreaterThan(before);expect(await page.evaluate(()=>window.__vtErrors)).toEqual([]);expect(errors).toEqual([]);
 await writeFile(`test-results/animation-${info.project.name}-transitions.json`,JSON.stringify(await page.evaluate(()=>({mode:'local-waapi',started:window.__vtStarts,ready:window.__vtReady,errors:window.__vtErrors})),null,2));
});

test('rapid auth requests apply the latest tab without snapshot queues or leaked animations',async({page})=>{
 await ready(page);const canvas=await page.locator('canvas').elementHandle();
 const results=await page.evaluate(async()=>{const sequence=[1,0,1,0,1,0],selected:number[]=[];for(const i of sequence){document.querySelectorAll<HTMLElement>('[role=tab]')[i].dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await new Promise(r=>setTimeout(r,40));selected.push([...document.querySelectorAll('[role=tab]')].findIndex(el=>el.getAttribute('aria-selected')==='true'));}return {sequence,selected};});
 expect(results.selected).toEqual(results.sequence);await expect(page.locator('.auth-form')).toHaveAttribute('data-auth-motion','idle');expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.id.startsWith('aiva-auth-')).length)).toBe(0);expect(await canvas?.evaluate(el=>el.isConnected)).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.id.startsWith('aiva-auth-')).length)).toBe(0);
});

test('compiled original palettes decode and remain mounted across theme changes',async({page})=>{
 await ready(page);const assets=page.locator('.living-theme img');await expect(assets).toHaveCount(4);await expect.poll(()=>assets.evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>=1200))).toBe(true);expect(await page.locator('.living-background circle').count()).toBe(0);
 const first=await assets.elementHandles();for(const theme of ['light','dark','light'])await selectTheme(page,theme);for(const image of first)expect(await image.evaluate(el=>el.isConnected)).toBe(true);
});

test('theme and processing preserve wave identity/phase without remounting NOVA',async({page})=>{
 await ready(page);await page.getByLabel('Email',{exact:true}).focus();await page.getByLabel('Email',{exact:true}).blur();await page.waitForTimeout(120);
 const canvas=await page.locator('canvas').elementHandle();const wave=await page.locator('.living-waves').first().evaluateHandle(el=>el.getAnimations()[0]||null);const exists=await wave.evaluate(a=>!!a);const initial=await wave.evaluate(a=>Number(a?.currentTime||0));
 for(const theme of ['light','dark','light']){await selectTheme(page,theme);await page.waitForTimeout(90);if(exists){expect(await wave.evaluate(a=>document.querySelector('.living-waves')!.getAnimations().includes(a!))).toBe(true);expect(await wave.evaluate(a=>Number(a!.currentTime))).toBeGreaterThanOrEqual(initial);}}
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);await page.route('**/api/auth/login',async route=>{await gate;await route.abort('failed');});await page.getByLabel('Email',{exact:true}).fill('ui-only@example.invalid');await page.getByLabel('Mật khẩu',{exact:true}).fill('ui-only-secret');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode','thinking');
 if(exists)await expect.poll(()=>wave.evaluate(a=>a!.playbackRate)).toBe(.55);release();await expect(page.locator('form').getByRole('alert')).toBeVisible();if(exists)await expect.poll(()=>wave.evaluate(a=>a!.playbackRate)).toBe(1);expect(await canvas?.evaluate(el=>el.isConnected)).toBe(true);
});

test('NOVA cancels its loop offscreen and hidden, then resumes with bounded time',async({page})=>{
 await page.setViewportSize({width:390,height:500});await ready(page);await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await page.waitForTimeout(250);await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForFunction(()=>window.__nova?.().loopActive===false);const off=await page.evaluate(()=>window.__nova!());await page.waitForTimeout(240);expect((await page.evaluate(()=>window.__nova!())).loopCallbacks).toBe(off.loopCallbacks);
 await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>window.__nova?.().loopActive===true);await page.waitForFunction(n=>(window.__nova?.().frames||0)>n,off.frames);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await page.evaluate(()=>window.__nova!());expect(hidden.loopActive).toBe(false);await page.waitForTimeout(200);expect((await page.evaluate(()=>window.__nova!())).loopCallbacks).toBe(hidden.loopCallbacks);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>window.__nova?.().loopActive===true);
});

test('pending spinner pauses when offscreen and releases on completion (transport fault)',async({page})=>{
 await page.setViewportSize({width:390,height:500});await ready(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);await page.route('**/api/auth/login',async route=>{await gate;await route.abort('failed');});
 await page.getByLabel('Email',{exact:true}).fill('ui-only@example.invalid');await page.getByLabel('Mật khẩu',{exact:true}).fill('ui-only-secret');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();const spinner=page.locator('.spinner');await expect(spinner).toHaveAttribute('data-motion-visible','true');await page.evaluate(()=>scrollTo(0,0));await expect(spinner).toHaveAttribute('data-motion-visible','false');expect(await spinner.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');release();await expect(spinner).toHaveCount(0);
});

test('reduced motion and unsupported View Transition keep all auth tabs functional',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await ready(page);for(const tab of ['Đăng ký','Đăng nhập'])await page.getByRole('tab',{name:tab,exact:true}).click();expect(await page.evaluate(()=>window.__vtStarts)).toBe(0);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.addInitScript(()=>{Object.defineProperty(document,'startViewTransition',{configurable:true,value:undefined});});await ready(page);await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await expect(page.getByLabel('Nhập lại mật khẩu',{exact:true})).toBeVisible();
});
