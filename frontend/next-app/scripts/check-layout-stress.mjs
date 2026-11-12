// Additional real-browser layout checks; requires an already running frontend.
// Never submits credentials or creates a session.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.AIVA_TEST_BASE_URL||'http://127.0.0.1:3100';
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{if(document.startViewTransition){const start=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{const transition=start(...args);window.__layoutTransition=transition.finished.catch(()=>{});return transition;};}});
 await mkdir('test-results/layout-stress',{recursive:true});
 for(const viewport of [{width:1280,height:620},{width:720,height:450},{width:320,height:720}]){
  await page.setViewportSize(viewport);
  await page.goto(`${base}/login`);
  await page.locator('[data-nova-status="ready"]').waitFor({timeout:30000});
  const toggle=page.getByRole('button',{name:'Đổi giao diện Sáng/Tối',exact:true});
  if(await toggle.getAttribute('data-theme-mode')!=='light')await toggle.click();
  await page.waitForTimeout(500);
  for(const view of ['login','register']){
   if(view==='register'){await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await page.getByRole('tab',{name:'Đăng ký',exact:true}).getAttribute('aria-selected');await page.evaluate(()=>window.__layoutTransition);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
   const submit=page.locator('form button[type="submit"]');
   await submit.scrollIntoViewIfNeeded();
   const box=await submit.boundingBox();
   assert.ok(box&&box.y>=0&&box.y+box.height<=viewport.height+1,'submit is clipped or unreachable');
   const email=page.getByLabel('Email',{exact:true});await email.focus();
   assert.equal(await email.evaluate(el=>el===document.activeElement),true);
   await email.blur();
   await page.evaluate(()=>window.scrollTo(0,0));
   const screenshot=`test-results/layout-stress/${viewport.width}x${viewport.height}-${view}.png`;
   await page.screenshot({path:screenshot,fullPage:true});
   results.push({viewport,view,status:'PASS',screenshot});
  }
 }
 await writeFile('test-results/layout-stress/results.json',JSON.stringify(results,null,2));
 console.log(`${results.length}/6 layout stress checks PASS (including 720x450 zoom-equivalent viewport).`);
}finally{await browser.close();}
