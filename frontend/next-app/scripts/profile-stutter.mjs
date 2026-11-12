// Bounded, production-only Edge/CDP profiling. No auth requests or application fixtures.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';

const label=process.argv[2]||'sample';
const directory=`.npm-cache/stutter/${label}`;
await mkdir(directory,{recursive:true});
process.env.NODE_ENV='production';
const {default:next}=await import('next');
let handle;const server=createServer((req,res)=>handle?handle(req,res):res.writeHead(503).end());
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const app=next({dir:process.env.AIVA_PROFILE_APP_DIR||'.',dev:false,hostname:'127.0.0.1',port});
await app.prepare();handle=app.getRequestHandler();
const browser=await chromium.launch({channel:'msedge',headless:true});
const browserCDP=await browser.newBrowserCDPSession();
const systemInfo=await browserCDP.send('SystemInfo.getInfo').catch(()=>null);
const report={label,browser:browser.version(),platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,headless:true,production:true,durationMs:2800,frameMetric:'requestAnimationFrame intervals; NOT presented-frame/GPU FPS',results:[]};
report.gpuInfo=systemInfo?.gpu;report.presentedFPS='NOT MEASURED';report.gpuUtilization='NOT MEASURED';
const environments=[{name:'desktop',width:1440,height:900,dpr:1,rate:1},{name:'mobile',width:390,height:844,dpr:2,rate:1},{name:'desktop-cpu4x',width:1440,height:900,dpr:1,rate:4}];
const cases=[['nova','idle'],['background','idle'],['form','tabs'],['all','idle'],['all','theme'],['all','tabs'],['all','pointer'],['all','mixed'],['no-vt','mixed'],['no-filter','mixed'],['no-backdrop','mixed'],['no-mesh','mixed'],['static-mesh','mixed'],['no-stop-tween','mixed'],['no-theme-tween','mixed'],['static-no-tween','mixed'],['no-all-tween','mixed'],['nova','theme'],['background','theme'],['form','theme'],['fixed-scheme','mixed'],['promoted','mixed'],['raster','mixed'],['no-body-tween','mixed']];
const percentile=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]||0;
try{
 for(const environment of environments){for(const [variant,operation] of cases){
  if(process.env.AIVA_PROFILE_CASE&&!`${environment.name}/${variant}/${operation}`.includes(process.env.AIVA_PROFILE_CASE))continue;
  if(process.env.AIVA_PROFILE_VARIANTS&&!process.env.AIVA_PROFILE_VARIANTS.split(',').includes(variant))continue;
  if(!process.env.AIVA_PROFILE_CASE&&['no-mesh','static-mesh','no-stop-tween','no-theme-tween','static-no-tween','no-all-tween','fixed-scheme','promoted','raster','no-body-tween'].includes(variant))continue;
  if(!process.env.AIVA_PROFILE_CASE&&operation==='theme'&&variant!=='all')continue;
  const context=await browser.newContext({viewport:{width:environment.width,height:environment.height},deviceScaleFactor:environment.dpr});
  await context.addInitScript(({variant})=>{
   const state={frames:[],longTasks:[],commits:[],components:{},transitions:[],actions:[],mounts:0,disposals:0,active:false};
   window.__stutter=state;
   window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(renderer){this.renderers.set(1,renderer);return 1;},onCommitFiberRoot(_id,root){if(!state.active)return;state.commits.push(performance.now());let count=0;const visit=f=>{if(!f||++count>10000)return;if(f.flags&1){const type=f.type,name=typeof type==='function'?(type.displayName||type.name):null;if(name)state.components[name]=(state.components[name]||0)+1;}visit(f.child);visit(f.sibling);};visit(root.current);},onCommitFiberUnmount(){}};
   new PerformanceObserver(list=>{if(state.active)for(const e of list.getEntries())state.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});}).observe({type:'longtask',buffered:false});
   document.addEventListener('aiva-nova:ready',e=>{state.mounts++;window.__nova=e.detail.snapshot;});
   document.addEventListener('aiva-nova:disposed',()=>state.disposals++);
   if(variant==='no-vt'||variant==='nova'||variant==='background')Object.defineProperty(document,'startViewTransition',{configurable:true,value:undefined});
   else if(document.startViewTransition){const start=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{const item={start:performance.now()};state.transitions.push(item);const transition=start(...args);transition.ready.then(()=>{item.readyMs=performance.now()-item.start;}).catch(e=>{item.error=String(e);});transition.finished.then(()=>{item.finishedMs=performance.now()-item.start;});return transition;};}
  },{variant});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:environment.rate});await cdp.send('Performance.enable');
  await page.goto(`${base}/login`);await page.locator('[data-nova-status="ready"]').waitFor({timeout:45000});await page.waitForTimeout(450);
  if(variant==='background'||variant==='form'){await page.getByRole('button',{name:'Ẩn NOVA 3D',exact:true}).click();await page.waitForTimeout(100);}
  if(variant==='nova'||variant==='form')await page.addStyleTag({content:'.living-background{display:none!important}'});
  if(variant==='nova'||variant==='background')await page.addStyleTag({content:'.auth-form-side{visibility:hidden!important}'});
  if(variant==='no-filter')await page.addStyleTag({content:'.living-waves [filter]{filter:none!important}'});
  if(variant==='no-backdrop')await page.addStyleTag({content:'.auth-form,.auth-card-surface,.auth-card-backdrop{backdrop-filter:none!important}'});
  if(variant==='no-mesh')await page.addStyleTag({content:'.living-mesh{display:none!important}'});
  if(variant==='static-mesh'||variant==='static-no-tween')await page.evaluate(()=>{const mesh=document.querySelector('.living-mesh');const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(mesh));image.className=mesh.getAttribute('class');image.alt='';mesh.replaceWith(image);});
  if(variant==='no-stop-tween')await page.addStyleTag({content:'.living-waves stop{transition:none!important}'});
  if(variant==='no-theme-tween'||variant==='static-no-tween')await page.addStyleTag({content:'.living-background,.living-background *,.living-background *::before,.living-background *::after{transition:none!important}'});
  if(variant==='no-all-tween')await page.addStyleTag({content:'*,*::before,*::after{transition:none!important}'});
  if(variant==='no-body-tween')await page.addStyleTag({content:'body{transition:none!important}'});
  if(variant==='fixed-scheme')await page.addStyleTag({content:'.living-background,.living-background img{color-scheme:only light!important}'});
  if(variant==='promoted')await page.addStyleTag({content:'.living-theme-light{will-change:opacity;transform:translateZ(0)}.living-parallax{will-change:transform}'});
  if(variant==='raster')await page.evaluate(async()=>{for(const image of document.querySelectorAll('.living-background img')){await image.decode();const canvas=new OffscreenCanvas(1600,900);canvas.getContext('2d').drawImage(image,0,0,1600,900);const url=URL.createObjectURL(await canvas.convertToBlob());image.closest('picture')?.querySelector('source')?.remove();image.src=url;await image.decode();}});
  // Baseline and after perform the same first physical pointer click, followed by
  // bounded in-page MouseEvents to stress interruption without Playwright waiting
  // for element stability between each click. No form submissions.
  if(!['nova','background'].includes(variant)){await page.getByRole('tab',{name:'Đăng nhập',exact:true}).click();}
  await page.mouse.move(80,240);await page.waitForTimeout(200);
  const getMetrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const before=await getMetrics();
  const raw=await page.evaluate(async({operation,duration})=>{
   const s=window.__stutter;s.active=true;s.frames=[];s.longTasks=[];s.commits=[];s.components={};s.transitions=[];s.actions=[];
   const initial=window.__nova?.(),wave=document.querySelector('.living-waves').getAnimations()[0],waveTime=wave?.currentTime;
   const start=performance.now();let previous=start,stopped=false;const timers=[];
   const frame=now=>{s.frames.push(now-previous);previous=now;if(!stopped)requestAnimationFrame(frame);};requestAnimationFrame(frame);
   const click=(kind,index)=>{const node=kind==='theme'?document.querySelector('[data-theme-toggle]'):document.querySelectorAll('[role=tab]')[index%3];const t=performance.now(),item={kind,at:t-start,commitMs:null,twoFramesMs:null};s.actions.push(item);const attr=kind==='theme'?'data-theme-mode':'aria-selected';const old=node.getAttribute(attr);const observer=new MutationObserver(()=>{if(node.getAttribute(attr)===old)return;item.commitMs=performance.now()-t;observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{item.twoFramesMs=performance.now()-t;}));});observer.observe(node,{attributes:true,attributeFilter:[attr]});timers.push(setTimeout(()=>observer.disconnect(),1000));node.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));};
   const schedule=(fn,interval)=>{for(let at=80,i=1;at<duration-650;at+=interval,i++)timers.push(setTimeout(()=>fn(i),at));};
   if(operation==='theme'||operation==='mixed')schedule(()=>click('theme',0),operation==='mixed'?400:300);
   if(operation==='tabs'||operation==='mixed')schedule(i=>click('tab',i),operation==='mixed'?160:100);
   if(operation==='pointer'||operation==='mixed')schedule(i=>{const event=new PointerEvent('pointermove',{bubbles:true,clientX:70+(i*37)%(innerWidth-110),clientY:220+(i*23)%180,pointerType:'mouse'});window.dispatchEvent(event);},16);
   await new Promise(resolve=>setTimeout(resolve,duration));stopped=true;s.active=false;timers.forEach(clearTimeout);
   return {intervals:s.frames,longTasks:s.longTasks,commits:s.commits.length,performedWorkFiberCounts:s.components,actions:s.actions,transitions:s.transitions,mounts:s.mounts,disposals:s.disposals,canvas:document.querySelectorAll('canvas').length,dom:document.querySelectorAll('*').length,novaFrames:initial?.frames===undefined?null:(window.__nova?.().frames-initial.frames),novaStats:window.__nova?.().stats,softwareGPU:window.__nova?.().softwareGPU,waveSame:wave?document.querySelector('.living-waves').getAnimations().includes(wave):null,waveTimes:[waveTime,wave?.currentTime]};
  },{operation,duration:report.durationMs});
  const after=await getMetrics(),intervals=raw.intervals.filter(n=>n>0).sort((a,b)=>a-b),mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const row={environment:environment.name,viewport:[environment.width,environment.height],dpr:environment.dpr,cpuRate:environment.rate,variant,operation,frame:{mean,p95:percentile(intervals,.95),p99:percentile(intervals,.99),max:intervals.at(-1),rafCadence:1000/mean,count:intervals.length,over33:intervals.filter(x=>x>33.34).length,over50:intervals.filter(x=>x>50).length},longTaskCount:raw.longTasks.length,longTaskTotal:raw.longTasks.reduce((sum,x)=>sum+x.duration,0),longTaskMax:Math.max(0,...raw.longTasks.map(x=>x.duration)),metrics:Object.fromEntries(['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].map(k=>[k,after[k]-before[k]])),...raw,errors};
  report.results.push(row);await writeFile(`${directory}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({environment:row.environment,variant,operation,frame:row.frame,longTasks:row.longTaskCount,task:row.metrics.TaskDuration,commits:row.commits,vt:row.transitions.map(t=>Math.round(t.readyMs||0))}));
  await context.close();
 }}
 // A separate trace keeps instrumentation overhead out of the comparative samples.
 if(!process.env.AIVA_PROFILE_CASE||process.env.AIVA_PROFILE_TRACE==='1'){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(`${base}/login`);await page.locator('[data-nova-status="ready"]').waitFor();
  const events=[];cdp.on('Tracing.dataCollected',data=>events.push(...data.value));await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,cc,gpu,disabled-by-default-devtools.timeline',options:'record-as-much-as-possible'});
  for(let i=0;i<6;i++){await page.getByRole('button',{name:'Đổi giao diện Sáng/Tối',exact:true}).click();await page.getByRole('tab',{name:['Đăng ký','Xác minh','Đăng nhập'][i%3],exact:true}).click({force:true});await page.waitForTimeout(90);}
  await page.waitForTimeout(350);const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await completed;
  await writeFile(`${directory}/timeline.json`,JSON.stringify({traceEvents:events}));
  const names=['Layout','UpdateLayoutTree','Paint','RasterTask','CompositeLayers','DrawFrame','BeginFrame','GPUTask','RunTask','CaptureViewTransition','ViewTransition'];
  report.traceSummary=Object.fromEntries(names.map(name=>{const list=events.filter(e=>e.name===name);return [name,{count:list.length,durationMs:list.reduce((sum,e)=>sum+(e.dur||0),0)/1000}];}));await writeFile(`${directory}/results.json`,JSON.stringify(report,null,2));await page.close();
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();}
