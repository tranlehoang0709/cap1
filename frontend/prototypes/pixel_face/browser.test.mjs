// Chạy sau khi mở HTTP preview 8510. Không dùng Streamlit, model camera hay profile cá nhân.
// AIVA_PIXEL_ARTIFACTS phải là thư mục mới bên ngoài source.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require('../../checks/trinh_duyet/node_modules/@playwright/test');
const output=process.env.AIVA_PIXEL_ARTIFACTS;
const source=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
if(!output||!path.isAbsolute(output)||!path.relative(source,path.resolve(output)).startsWith('..'))throw Error('Artifacts phải nằm ngoài frontend');
await fs.mkdir(output,{recursive:false});
const origin='http://127.0.0.1:8510';
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const errors=[],unexpected=[],results=[],recordings=[];
const ffmpeg=path.join(process.env.LOCALAPPDATA||'','ms-playwright','ffmpeg-1013','ffmpeg-win64.exe');
const videoAvailable=await fs.access(ffmpeg).then(()=>true,()=>false);
const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,
 ...(videoAvailable?{recordVideo:{dir:path.join(output,'video'),size:{width:960,height:720}}}:{})});
await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin && route.request().method()==='GET')return route.continue();
  unexpected.push(url.href);return route.abort();
});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function pixels(){return page.locator('#face').evaluate(c=>{
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let count=0,x0=c.width,y0=c.height,x1=0,y1=0;
  for(let i=0;i<data.length;i+=4)if(data[i+1]>80){const p=i/4,x=p%c.width,y=Math.floor(p/c.width);count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  return {count,bounds:[x0,y0,x1,y1],hash:Array.from(data).join(',')};
});}
async function hash(){return createHash('sha256').update((await pixels()).hash).digest('hex');}
try{
 await page.goto(origin);await page.locator('[data-expression=happy]').waitFor();
 assert.equal(await page.locator('#face').getAttribute('width'),'128');
 const staticHashes=[];
 await page.locator('#reduce-motion').check();
 for(const id of ['neutral','happy','angry','sad','sleepy']){
  await page.locator(`[data-expression=${id}]`).click();
  assert.equal(await page.locator(`[data-expression=${id}]`).getAttribute('aria-pressed'),'true');
  const p=await pixels();staticHashes.push(await hash());
  assert.ok(p.count>50 && p.bounds[0]>0 && p.bounds[2]<128 && p.bounds[3]<64);
  await page.locator('.display-shell').screenshot({path:path.join(output,`${id}.png`)});
 }
 assert.equal(new Set(staticHashes).size,5);results.push('five-static-silhouettes: PASS');
 for(let i=0;i<10;i++)for(const id of ['happy','angry','sad','sleepy','neutral'])await page.locator(`[data-expression=${id}]`).click();
 assert.equal(await hash(),staticHashes[0]);results.push('50-switches-no-drift: PASS');
 await page.locator('#reduce-motion').uncheck();
 for(const id of ['neutral','happy','angry','sad','sleepy']){
  await page.locator(`[data-expression=${id}]`).click();
  await page.waitForTimeout(450);const before=await hash();
  let changed=false;
  for(let i=0;i<45;i++){await page.waitForTimeout(100);if(await hash()!==before){changed=true;break;}}
  assert.ok(changed,`Animation did not change pixels: ${id}`);
  await page.locator('.display-shell').screenshot({path:path.join(output,`${id}-animated.png`)});
  const recording=await page.locator('#face').evaluate(async canvas=>{
    if(!canvas.captureStream||typeof MediaRecorder==='undefined')return null;
    const mimeType=['video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mimeType)return null;
    const stream=canvas.captureStream(12),recorder=new MediaRecorder(stream,{mimeType}),chunks=[];
    try{
      const done=new Promise((resolve,reject)=>{
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.onerror=()=>reject(Error('Canvas recording failed'));
        recorder.onstop=resolve;
      });
      recorder.start();await new Promise(resolve=>setTimeout(resolve,1400));recorder.stop();await done;
      const bytes=new Uint8Array(await new Blob(chunks,{type:mimeType}).arrayBuffer());
      return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
    }finally{stream.getTracks().forEach(track=>track.stop());}
  });
  if(recording){await fs.writeFile(path.join(output,`${id}.webm`),Buffer.from(recording,'base64'));recordings.push(`${id}.webm`);}
 }
 results.push('five-animation-patterns: PASS');
 await page.locator('#play').click();
 const frozen=await hash();await page.waitForTimeout(400);assert.equal(await hash(),frozen);
 await page.locator('[data-expression=happy]').click();
 const newPose=await hash();await page.waitForTimeout(200);assert.equal(await hash(),newPose);
 results.push('pause-and-static-selection: PASS');
 await page.locator('#play').click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.getElementById('motion-status').textContent==='Giảm chuyển động');
 assert.equal(await page.locator('#motion-status').textContent(),'Giảm chuyển động');
 const reduced=await hash();await page.waitForTimeout(400);assert.equal(await hash(),reduced);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.waitForFunction(()=>document.getElementById('motion-status').textContent!=='Giảm chuyển động');
 await page.setViewportSize({width:390,height:300});
 await page.locator('.playback').scrollIntoViewIfNeeded();
 await page.waitForTimeout(150);
 const offscreen=await hash();await page.waitForTimeout(400);assert.equal(await hash(),offscreen);
 await page.locator('#face').scrollIntoViewIfNeeded();await page.waitForTimeout(650);
 assert.notEqual(await hash(),offscreen);results.push('offscreen-pause-and-resume: PASS');
 await page.locator('#reduce-motion').check();
 for(const width of [390,768,1024,1440]){
  await page.setViewportSize({width,height:1080});
  const layout=await page.evaluate(()=>{
    const c=document.querySelector('canvas').getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth>innerWidth,canvas:{left:c.left,right:c.right,width:c.width,height:c.height},smoothing:document.querySelector('canvas').getContext('2d').imageSmoothingEnabled,buttons:[...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};})};
  });
  assert.equal(layout.overflow,false);assert.equal(layout.smoothing,false);
  assert.ok(layout.canvas.left>=0&&layout.canvas.right<=width);
  assert.ok(layout.buttons.every(b=>b.left>=0&&b.right<=width&&b.height>=38));
  if(width===390||width===1440)await page.screenshot({path:path.join(output,`preview-${width}.png`),fullPage:true});
  results.push(`responsive-${width}: PASS`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const report={browser:browser.version(),origin,results,errors,unexpected,recordings,
  video:recordings.length===5?'5 canvas WebM via built-in MediaRecorder':videoAvailable?'Playwright video captured':'NOT RUN: encoder unavailable; no installation attempted',status:'PASS'};
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'FAIL',results,error:error.stack,errors,unexpected},null,2));
 throw error;
}finally{await context.close();await browser.close();}
