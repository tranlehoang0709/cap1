// Sequential foreground frame sampling, isolated from the parallel E2E runner.
// This is a local comparison, not a device benchmark or a guaranteed FPS target.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.AIVA_TEST_BASE_URL||'http://127.0.0.1:3100';
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{document.addEventListener('aiva-nova:ready',event=>{window.__nova=event.detail.snapshot;});});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(`${base}/login`);
  await page.locator('[data-nova-status="ready"]').waitFor({timeout:30000});
  await page.waitForTimeout(2400);
  for(const theme of ['dark','light']){
   const toggle=page.getByRole('button',{name:'Đổi giao diện Sáng/Tối',exact:true});
   if(await toggle.getAttribute('data-theme-mode')!==theme)await toggle.click();
   await page.getByRole('heading',{name:'Một kết nối. Nhiều khả năng.'}).click();
   await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500);
   const samples=[];
   for(const enabled of [true,false,true]){
    await page.locator('[data-background="living"]').evaluate((el,shown)=>{el.style.display=shown?'':'none';},enabled);
    await page.waitForTimeout(200);
    const before=await page.evaluate(()=>({frames:window.__nova().frames,now:performance.now()}));
    await page.waitForTimeout(1400);
    const after=await page.evaluate(()=>({frames:window.__nova().frames,now:performance.now(),hidden:document.hidden,softwareGPU:window.__nova().softwareGPU}));
    samples.push({enabled,fps:+((after.frames-before.frames)*1000/(after.now-before.now)).toFixed(1),hidden:after.hidden,softwareGPU:after.softwareGPU});
   }
   results.push({viewport,theme,samples});
  }
 }
 await mkdir('test-results/performance',{recursive:true});
 await writeFile('test-results/performance/background.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
