// Bounded, read-only page profiling. Run before/after against the same dev host.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const label=process.argv[2]||'sample';
const base=process.env.AIVA_TEST_BASE_URL||'http://127.0.0.1:3100';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const report={label,profiles:[],tabs:[],pointer:null,theme:null,idle:null};
try{
 await page.addInitScript(()=>{
  const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),pending=new Set();let callbacks=0,mounts=0,disposals=0;
  window.requestAnimationFrame=fn=>{let id;id=request(time=>{pending.delete(id);callbacks++;fn(time);});pending.add(id);return id;};
  window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
  document.addEventListener('aiva-nova:ready',event=>{mounts++;window.__nova=event.detail.snapshot;});document.addEventListener('aiva-nova:disposed',()=>disposals++);
  const shifts=[];new PerformanceObserver(list=>{for(const e of list.getEntries())shifts.push({value:e.value,recent:e.hadRecentInput});}).observe({type:'layout-shift',buffered:true});
  window.__audit=()=>({callbacks,pending:pending.size,mounts,disposals,shifts:shifts.slice()});
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
 const read=()=>page.evaluate(()=>{
  const animations=[];for(const element of [...document.querySelectorAll('body *')].slice(0,5000))for(const pseudo of [null,'::before','::after']){
   const style=getComputedStyle(element,pseudo);if(style.animationName==='none'||style.display==='none')continue;const r=element.getBoundingClientRect();const visible=r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
   animations.push({name:style.animationName,state:style.animationPlayState,visible,pseudo,owner:element.getAttribute('class')});
  }
  return {audit:window.__audit(),nova:window.__nova?.(),animations,offscreenRunning:animations.filter(a=>!a.visible&&a.state==='running').length,dom:document.querySelectorAll('*').length,canvas:document.querySelectorAll('canvas').length,iframe:document.querySelectorAll('iframe').length,scrollY,hidden:document.hidden};
 });
 const ready=async()=>{await page.goto(`${base}/login`);await page.locator('[data-nova-status="ready"]').waitFor({timeout:30000});await page.waitForTimeout(400);};
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:390,height:500}]){
  await page.setViewportSize(viewport);await ready();await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await page.waitForTimeout(300);
  for(const position of ['top','middle','bottom']){
   await page.evaluate(p=>scrollTo(0,p==='top'?0:p==='middle'?(document.documentElement.scrollHeight-innerHeight)/2:document.documentElement.scrollHeight),position);await page.waitForTimeout(250);
   const a=await read();await page.waitForTimeout(250);const b=await read();report.profiles.push({viewport,position,rafCallbacks:b.audit.callbacks-a.audit.callbacks,renderedFrames:(b.nova?.frames||0)-(a.nova?.frames||0),state:b});
  }
 }
 await page.setViewportSize({width:1440,height:900});await ready();
 const box=()=>page.evaluate(()=>{const r=document.querySelector('.auth-form').getBoundingClientRect(),n=document.querySelector('canvas').getBoundingClientRect();return {card:{top:r.top,height:r.height},canvas:{top:n.top,height:n.height},mounts:window.__audit().mounts,wave:document.querySelector('.living-waves').getAnimations().map(a=>({time:a.currentTime,rate:a.playbackRate}))};});
 for(const tab of ['Đăng nhập','Đăng ký','Xác minh','Đăng nhập']){const before=await box();await page.getByRole('tab',{name:tab,exact:true}).click();const immediate=await box();await page.waitForTimeout(250);report.tabs.push({tab,before,immediate,after:await box()});}
 const beforeTheme=await box();await page.getByRole('button',{name:'Đổi giao diện Sáng/Tối'}).click();await page.waitForTimeout(250);report.theme={before:beforeTheme,after:await box()};
 const a=await metrics();for(let i=0;i<40;i++)await page.mouse.move(100+i*25,300+(i%8)*22);await page.waitForTimeout(100);const b=await metrics();
 report.pointer=Object.fromEntries(['LayoutCount','RecalcStyleCount','RecalcStyleDuration','LayoutDuration','ScriptDuration','TaskDuration'].map(k=>[k,b[k]-a[k]]));
 const first=await read(),heap=await metrics();await page.waitForTimeout(15000);report.idle={before:first,after:await read(),heapBefore:heap.JSHeapUsedSize,heapAfter:(await metrics()).JSHeapUsedSize};
 await mkdir('.npm-cache/animation-audit',{recursive:true});await writeFile(`.npm-cache/animation-audit/${label}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({label,profiles:report.profiles.map(p=>({viewport:p.viewport,position:p.position,offscreenRunning:p.state.offscreenRunning,raf:p.rafCallbacks,frames:p.renderedFrames,dom:p.state.dom,canvas:p.state.canvas})),tabs:report.tabs,pointer:report.pointer,idleCounts:[report.idle.before.dom,report.idle.after.dom]},null,2));
}finally{await browser.close();}
