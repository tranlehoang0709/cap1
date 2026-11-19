// One short before/after trial; no build, suite, or successful auth fixtures.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const phase=process.argv[2]||'before';
const output='test-results/animate-ui-auth';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:false});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'no-preference'});
 await context.addInitScript(()=>{
  localStorage.setItem('theme','dark');
  window.__nova={ready:0,disposed:0,snapshot:null};
  document.addEventListener('aiva-nova:ready',event=>{window.__nova.ready++;window.__nova.snapshot=event.detail.snapshot;});
  document.addEventListener('aiva-nova:disposed',()=>window.__nova.disposed++);
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:3100/login');
 await page.locator('[data-nova-status=ready]').waitFor({timeout:60000});
 await page.waitForTimeout(4000);
 await page.evaluate(()=>{
  window.__canvas=document.querySelector('canvas');
  const data=window.__trial={gaps:[],tasks:[],last:performance.now(),start:performance.now(),ready:window.__nova.ready,disposed:window.__nova.disposed,novaStart:window.__nova.snapshot?.()};
  data.observer=new PerformanceObserver(list=>data.tasks.push(...list.getEntries().map(entry=>entry.duration)));
  data.observer.observe({type:'longtask'});
  const tick=now=>{data.gaps.push(now-data.last);data.last=now;data.raf=requestAnimationFrame(tick);};data.raf=requestAnimationFrame(tick);
 });
 const start=performance.now();
 const at=async(ms,fn)=>{await page.waitForTimeout(Math.max(0,ms-(performance.now()-start)));await fn();};
 const tab=name=>page.getByRole('tab',{name,exact:true}).click({force:true});
 const theme=()=>page.locator('[data-theme-toggle]').click({force:true});
 await at(0,()=>tab('Đăng ký'));await at(120,theme);
 await at(240,()=>tab('Xác minh'));await at(360,theme);
 await at(480,()=>tab('Đăng nhập'));
 await at(600,()=>page.mouse.move(100,250));await at(700,()=>page.mouse.move(1000,400));
 await at(3000,async()=>{});
 const metrics=await page.evaluate(()=>{
  const data=window.__trial;cancelAnimationFrame(data.raf);data.tasks.push(...data.observer.takeRecords().map(entry=>entry.duration));data.observer.disconnect();
  const sorted=[...data.gaps].sort((a,b)=>a-b),percentile=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
  return {maxRafGapMs:Math.max(...sorted),p95RafGapMs:percentile(.95),p99RafGapMs:percentile(.99),longTaskCount:data.tasks.length,longTaskMaxMs:Math.max(0,...data.tasks),sameCanvas:window.__canvas===document.querySelector('canvas'),novaReady:window.__nova.ready-data.ready,novaDisposed:window.__nova.disposed-data.disposed,novaBefore:data.novaStart,novaAfter:window.__nova.snapshot?.()};
 });
 await writeFile(`${output}/${phase}-metrics.json`,JSON.stringify(metrics,null,2));
 assert.equal(metrics.sameCanvas,true);assert.equal(metrics.novaDisposed,0);
 assert.equal(metrics.novaAfter.loopActive,true);assert.ok(metrics.novaAfter.frames>metrics.novaBefore.frames);
 await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await page.getByLabel('Họ và tên',{exact:true}).waitFor();
 await page.waitForTimeout(80);await page.screenshot({path:`${output}/${phase}-midpoint.png`});
 assert.equal(await page.locator('#auth-form form').count(),1);
 await page.getByRole('tab',{name:'Xác minh',exact:true}).click();await page.locator('input[name=token]').waitFor();
 await page.getByRole('tab',{name:'Đăng nhập',exact:true}).click();await page.locator('input[name=email]').waitFor();
 const modes=[];for(let i=0;i<2;i++){await theme();modes.push(await page.locator('[data-theme-toggle]').getAttribute('data-theme-mode'));}
 assert.deepEqual(modes,['light','dark']);
 await page.screenshot({path:`${output}/${phase}-desktop.png`});
 // Validation failure only: mismatched register passwords never call the API.
 await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();
 await page.locator('[name=display_name]').fill('Animation check');await page.locator('[name=email]').fill('check@example.com');
 await page.locator('[name=password]').fill('Test-password-123');await page.locator('[name=confirm_password]').fill('Different-password-123');
 await page.locator('button[type=submit]').click();await page.locator('#auth-form [role=alert]').waitFor();
 // Network failure tests the real pending/error handler without real credentials or fake success.
 await page.getByRole('tab',{name:'Đăng nhập',exact:true}).click();
 await page.locator('[name=email]').fill('check@example.com');await page.locator('[name=password]').fill('Test-password-123');
 await page.route('**/api/auth/login',async route=>{await new Promise(resolve=>setTimeout(resolve,350));await route.abort('failed');});
 const button=page.locator('button[type=submit]'),idle=await button.boundingBox();await button.click();
 await page.waitForFunction(()=>document.querySelector('button[type=submit]')?.getAttribute('aria-busy')==='true');const busy=await button.boundingBox();
 await page.locator('#auth-form [role=alert]').waitFor();assert.ok(Math.abs(idle.width-busy.width)<.5);assert.ok(Math.abs(idle.height-busy.height)<.5);
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
 for(const name of ['Đăng ký','Xác minh','Đăng nhập'])await tab(name);
 await page.waitForTimeout(500);assert.equal(await page.locator('input[name=email]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:`${output}/${phase}-mobile-reduced.png`});
 assert.deepEqual(errors,[]);
 const result={phase,browser:browser.version(),headless:false,viewport:'1440x900',dpr:1,cpuThrottle:1,development:true,...metrics,checks:{threeTabs:true,theme:true,novaIdentity:true,error:true,loadingSize:true,mobileReduced:true},fps:'NOT MEASURED',gpu:'NOT MEASURED',errors};
 await writeFile(`${output}/${phase}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
