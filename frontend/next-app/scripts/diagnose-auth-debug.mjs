// Exactly six short development trials. No build, test runner, auth submission,
// performance optimization or production host. Uses the existing dev server.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
const base=process.env.AIVA_DEBUG_BASE_URL||'http://127.0.0.1:3100';
const output='test-results/auth-debug-diagnosis';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:false});
const report={browser:browser.version(),cpu:os.cpus()[0]?.model,viewport:{width:1440,height:900},dpr:1,headless:false,cpuThrottle:1,mode:'development',warmupMs:4000,nominalTrialMs:3000,metric:'largest requestAnimationFrame gap; not presented-frame FPS or exact freeze duration',results:[]};
const cases={A:{nova:true,background:true,glass:true,form:true},B:{nova:false,background:true,glass:true,form:true},C:{nova:true,background:false,glass:true,form:true},D:{nova:true,background:true,glass:false,form:true},E:{nova:true,background:true,glass:true,form:false},F:{nova:false,background:false,glass:true,form:true}};
try{
 const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,reducedMotion:'no-preference'});
 await context.addInitScript(()=>{
  localStorage.setItem('theme','dark');
  const state={snapshot:null,disposals:[],authCalls:0,authObservers:new Set(),nativeCalls:0};window.__authIsolation=state;
  document.addEventListener('aiva-nova:ready',event=>{state.snapshot=event.detail.snapshot;});
  document.addEventListener('aiva-nova:disposed',event=>state.disposals.push(event.detail));
  const Native=ResizeObserver;
  window.ResizeObserver=class extends Native{constructor(callback){super(callback);this.authTargets=new Set();}observe(target,options){if(target.id==='auth-form'){this.authTargets.add(target);state.authObservers.add(target);}return super.observe(target,options);}unobserve(target){this.authTargets.delete(target);state.authObservers.delete(target);return super.unobserve(target);}disconnect(){for(const target of this.authTargets)state.authObservers.delete(target);this.authTargets.clear();return super.disconnect();}};
  const animate=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.matches('.auth-card-surface'))state.authCalls++;return animate.apply(this,args);};
  if(document.startViewTransition){const start=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{state.nativeCalls++;return start(...args);};}
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/login?authDebug=1`);await page.locator('[data-auth-debug-ready=true]').waitFor({timeout:60000});
 for(const [id,flags] of Object.entries(cases)){
  await page.locator('[data-auth-debug-panel]').evaluate(node=>node.open=true);
  await page.locator(`[data-debug-preset=${id}]`).click();
  for(const [key,value] of Object.entries(flags))assert.equal(await page.locator(`[data-debug-switch=${key}]`).getAttribute('aria-checked'),String(value));
  await page.locator('[data-auth-debug-panel]').evaluate(node=>node.open=false);
  await page.bringToFront();
  if(flags.nova)await page.locator('[data-nova-status=ready]').waitFor({timeout:30000});else await page.waitForFunction(()=>document.querySelectorAll('canvas').length===0);
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.living-theme img')].map(image=>image.decode().catch(()=>{})));});
  await page.waitForTimeout(report.warmupMs);
  await page.evaluate(()=>{
   const state=window.__authIsolation,begin=performance.now(),sample={begin,intervals:[],longTasks:[],raf:0,last:begin,startCalls:state.authCalls,startNative:state.nativeCalls,offSnapshot:state.snapshot?.()};
   sample.observer=PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=begin)sample.longTasks.push({startMs:entry.startTime-begin,durationMs:entry.duration});}):null;
   sample.observer?.observe({type:'longtask',buffered:false});
   const tick=now=>{sample.intervals.push(now-sample.last);sample.last=now;sample.raf=requestAnimationFrame(tick);};sample.raf=requestAnimationFrame(tick);state.sample=sample;
  });
  const began=performance.now(),at=async(ms,action)=>{const remaining=ms-(performance.now()-began);if(remaining>0)await page.waitForTimeout(remaining);await action();};
  const theme=()=>page.locator('[data-theme-toggle]').click({force:true});
  const tab=name=>page.getByRole('tab',{name,exact:true}).click({force:true});
  await at(0,theme);await at(120,()=>tab('Đăng ký'));await at(240,theme);await at(360,()=>tab('Xác minh'));await at(480,()=>tab('Đăng nhập'));
  await at(620,()=>page.mouse.move(90,250));await at(700,()=>page.mouse.move(700,420));await at(780,()=>page.mouse.move(1250,360));
  await at(900,theme);await at(1100,theme);await at(3000,async()=>{});
  const result=await page.evaluate(()=>{
   const state=window.__authIsolation,sample=state.sample;cancelAnimationFrame(sample.raf);
   for(const entry of sample.observer?.takeRecords()||[])if(entry.startTime>=sample.begin)sample.longTasks.push({startMs:entry.startTime-sample.begin,durationMs:entry.duration});sample.observer?.disconnect();
   const root=document.querySelector('.smart-auth'),background=root.querySelector('.living-background'),snapshot=state.snapshot?.();let filters=0;
   for(const node of [root,...root.querySelectorAll('*')])for(const pseudo of [null,'::before','::after']){const style=getComputedStyle(node,pseudo);if(style.display!=='none'&&(style.filter!=='none'||style.backdropFilter!=='none'))filters++;}
   return {elapsedMs:performance.now()-sample.begin,maxRafGapMs:Math.max(0,...sample.intervals),longTaskCount:sample.observer?sample.longTasks.length:null,longTaskMaxMs:sample.observer?Math.max(0,...sample.longTasks.map(e=>e.durationMs)):null,longTasks:sample.longTasks,framesObserved:sample.intervals.length,canvasCount:root.querySelectorAll('canvas').length,backgroundCount:background?1:0,backgroundAnimations:background?.getAnimations({subtree:true}).length||0,filterOwners:filters,backdropNodes:root.querySelectorAll('.auth-card-backdrop').length,authObserverCount:state.authObservers.size,authAnimationsCreated:state.authCalls-sample.startCalls,authAnimationsActive:document.getAnimations().filter(animation=>animation.id.startsWith('aiva-auth')).length,nativeTransitions:state.nativeCalls-sample.startNative,disposed:!!snapshot?.disposed,loopActive:snapshot?.loopActive,offLoopStable:snapshot?.disposed?sample.offSnapshot?.loopCallbacks===snapshot.loopCallbacks:null,selectedTab:root.querySelector('[role=tab][aria-selected=true]')?.textContent,theme:root.querySelector('[data-theme-toggle]').getAttribute('data-theme-mode')};
  });
  assert.equal(result.canvasCount,flags.nova?1:0);assert.equal(result.backgroundCount,flags.background?1:0);
  if(!flags.nova){assert.equal(result.disposed,true);assert.equal(result.loopActive,false);assert.equal(result.offLoopStable,true);}
  if(!flags.background)assert.equal(result.backgroundAnimations,0);
  if(!flags.glass){assert.equal(result.filterOwners,0);assert.equal(result.backdropNodes,0);}
  if(!flags.form){assert.equal(result.authObserverCount,0);assert.equal(result.authAnimationsCreated,0);assert.equal(result.authAnimationsActive,0);}else assert.ok(result.authAnimationsCreated>0);
  assert.equal(result.selectedTab,'Đăng nhập');assert.equal(result.theme,'dark');
  report.results.push({case:id,flags,...result});await writeFile(`${output}/results.json`,JSON.stringify({...report,errors},null,2));
  console.log(JSON.stringify({case:id,maxRafGapMs:result.maxRafGapMs,longTaskCount:result.longTaskCount,longTaskMaxMs:result.longTaskMaxMs,canvas:result.canvasCount,bg:result.backgroundCount,filters:result.filterOwners,formAnimations:result.authAnimationsCreated}));
 }
 assert.deepEqual(errors,[]);console.log('6/6 development isolation configurations verified; no build or test suites run.');
}finally{await browser.close();}
