import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../server.mjs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require('../../node_modules/@playwright/test');
const dir=fileURLToPath(new URL('../artifacts/',import.meta.url));await mkdir(dir,{recursive:true});
const server=await createPreviewServer();const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const report=[];
try{
 for(const [name,width,height]of [['desktop',1440,1100],['tablet',820,1180],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3200');await page.waitForFunction(()=>window.novaDiagnostics?.().frames>5);await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:dir+`/${name}-initial.png`,fullPage:true});const initial=await page.evaluate(()=>window.novaDiagnostics());const target=initial.hitPoint;await page.locator('canvas').click({position:target});assert.equal((await page.evaluate(()=>window.novaDiagnostics())).action,'react');assert.ok(initial.stats.triangles>0);assert.equal(await page.locator('canvas').count(),1);
  if(name==='desktop'){
   await page.locator('#idle').click();const before=await page.evaluate(()=>window.novaDiagnostics());const bounds=await page.locator('canvas').boundingBox();await page.mouse.move(bounds.x+bounds.width*.93,bounds.y+bounds.height*.3);await page.waitForTimeout(250);assert.ok(Math.abs((await page.evaluate(()=>window.novaDiagnostics())).head[1]-before.head[1])>.01);
   await page.locator('#body-motion').uncheck();await page.waitForTimeout(650);assert.ok(Math.abs((await page.evaluate(()=>window.novaDiagnostics())).pose.torsoY)<.003);await page.locator('#body-motion').check();
   await page.locator('#emotion').selectOption('sleepy');await page.waitForTimeout(350);const sleepy=await page.evaluate(()=>window.novaDiagnostics());await page.locator('#emotion').selectOption('surprised');await page.waitForTimeout(350);assert.ok((await page.evaluate(()=>window.novaDiagnostics())).eye[1]>sleepy.eye[1]);
   await page.locator('#quality').selectOption('lite');await page.waitForTimeout(1200);assert.equal((await page.evaluate(()=>window.novaDiagnostics())).stats.quality,'lite');await page.locator('#quality').selectOption('high');
  }
  for(const action of ['wave','dance','celebrate','react']){await page.locator(`[data-action="${action}"]`).click();await page.waitForTimeout(450);assert.equal((await page.evaluate(()=>window.novaDiagnostics())).action,action);}
  await page.locator('#emotion').selectOption('love');await page.locator('#blink').click();
  await page.locator('#pause').click();await page.waitForTimeout(100);const paused=await page.evaluate(()=>window.novaDiagnostics());await page.waitForTimeout(350);const frozen=await page.evaluate(()=>window.novaDiagnostics());assert.equal(frozen.time,paused.time);assert.equal(frozen.frames,paused.frames);await page.locator('#pause').click();
  await page.locator('#sfx').check();await page.waitForFunction(()=>window.novaDiagnostics().audio.state==='running');await page.locator('[data-action="wave"]').click();assert.equal((await page.evaluate(()=>window.novaDiagnostics())).audio.enabled,true);await page.locator('#sfx').uncheck();assert.equal((await page.evaluate(()=>window.novaDiagnostics())).audio.voices,0);
  await page.locator('#rotation').evaluate(el=>{el.value='75';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#rotation-value').innerText(),'75°');await page.locator('#reset').click();assert.equal(await page.locator('#rotation-value').innerText(),'0°');
  await page.locator('#idle').click();await page.waitForTimeout(400);await page.locator('#pause').click();await page.locator('.stage').scrollIntoViewIfNeeded();await page.screenshot({path:dir+`/${name}.png`,fullPage:true});
  const snapshot=await page.evaluate(()=>window.novaDiagnostics());report.push({name,viewport:{width,height},stats:snapshot.stats,errors});
  await page.locator('#destroy').click();const released=await page.evaluate(()=>window.novaDiagnostics());assert.equal(released.memory.geometries,0);assert.equal(released.memory.textures,0);assert.equal(await page.locator('canvas').count(),0);assert.equal((await page.evaluate(()=>window.novaDiagnostics())).disposed,true);assert.equal((await page.evaluate(()=>window.novaDiagnostics())).audio.state,'closed');await page.locator('#mount').click();await page.locator('.stage').scrollIntoViewIfNeeded();await page.waitForFunction(()=>window.novaDiagnostics().frames>3);assert.equal(await page.locator('canvas').count(),1);assert.deepEqual(errors,[]);await page.close();
 }
 const reduced=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await reduced.goto('http://127.0.0.1:3200');await reduced.waitForFunction(()=>window.novaDiagnostics?.().frames>=1);assert.equal((await reduced.evaluate(()=>window.novaDiagnostics())).reduced,true);await reduced.locator('[data-action="dance"]').click();await reduced.waitForTimeout(200);const p=await reduced.evaluate(()=>window.novaDiagnostics());await reduced.waitForTimeout(300);assert.deepEqual((await reduced.evaluate(()=>window.novaDiagnostics())).pose,p.pose);await reduced.close();
 await writeFile(dir+'/browser-results.json',JSON.stringify({pass:true,report,reducedMotion:true,cleanup:true},null,2));console.log(JSON.stringify({pass:true,report,reducedMotion:true,cleanup:true},null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
