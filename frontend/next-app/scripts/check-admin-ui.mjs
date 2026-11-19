// Focused real-Edge component checks, not an authenticated E2E success claim.
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=path.resolve('test-results/admin-dashboard-ui');await mkdir(directory,{recursive:true});
// Use the existing Tailwind toolchain. No install, Next build, product route,
// auth interception, backend mocking or state mutation outside this preview.
const css=await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
const rest=await Promise.all(['aiva-backgrounds.css','aiva-workspace.css','aiva-motion.css'].map(name=>readFile(`src/app/${name}`,'utf8')));
const scoped=await readFile('src/components/admin/admin-workspace.css','utf8');
await writeFile(`${directory}/style.css`,[css.css,...rest,scoped].join('\n'));
await build({entryPoints:['tests/admin-ui-preview.tsx'],bundle:true,outfile:`${directory}/app.js`,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},banner:{js:'var process={env:{NODE_ENV:"development"},browser:true,nextTick:(fn,...args)=>queueMicrotask(()=>fn(...args))};'},plugins:[{name:'css-already-compiled',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
const server=http.createServer(async(req,res)=>{
 try{const filename=req.url?.split('?')[0];if(filename==='/app.js'||filename==='/style.css'){
   res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(path.join(directory,filename)));return;
  }
  if(filename==='/robot/index.html'){res.writeHead(503);res.end('Robot engine is not served by isolated UI checks.');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:false});
const result={kind:'isolated component; NOT authenticated E2E',browser:browser.version(),checks:[],errors:[],screenshots:[],authenticatedE2E:'BLOCKED: Backend unavailable; no Admin session/credentials supplied'};
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
 const page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('.admin-dashboard').waitFor();
 await page.locator('[data-hydrated=true]').waitFor();
 const names=['dashboard','users','robots','ai','keys','quotas','firmware','monitoring','settings','account'];
 assert.deepEqual(await page.locator('nav a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),names.map(name=>`/admin/${name}`));
 assert.equal(await page.locator('[data-theme-toggle]').count(),1);assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).count(),1);
 assert.deepEqual(await page.locator('.metric-card strong').allTextContents(),['—','—','—','—']);
 assert.equal(await page.getByRole('link',{name:'Quản lý robot',exact:true}).getAttribute('href'),'/admin/robots');
 result.checks.push('All 10 navigation hrefs, original CTA, one theme/logout, unavailable KPIs');
 for(const [width,height] of [[1600,900],[1440,900],[768,1024],[390,844]]){
  await page.setViewportSize({width,height});
  for(const mode of ['dark','light']){
   if(await page.locator('[data-theme-toggle]').getAttribute('data-theme-mode')!==mode)await page.locator('[data-theme-toggle]').click();
   await page.waitForTimeout(260);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width} ${mode}`);
   const filename=`${width}-${height}-${mode}.png`;await page.screenshot({path:`${directory}/${filename}`,fullPage:true});result.screenshots.push(filename);
  }
 }
 result.checks.push('8 responsive/theme component snapshots; no whole-page horizontal overflow');
 const toggle=page.locator('[data-theme-toggle]');const mode=await toggle.getAttribute('data-theme-mode');
 await page.reload();await page.locator('[data-hydrated=true]').waitFor();assert.equal(await toggle.getAttribute('data-theme-mode'),mode);
 await page.getByRole('button',{name:'Mở menu',exact:true}).click();
 assert.equal(await page.locator('#aiva-sidebar').evaluate(node=>getComputedStyle(node).visibility),'visible');
 await page.keyboard.press('Escape');await page.waitForTimeout(180);assert.equal(await page.getByRole('button',{name:'Mở menu',exact:true}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Mở menu',exact:true}).click();await page.getByRole('link',{name:'Người dùng',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Mở menu',exact:true}).getAttribute('aria-expanded'),'false');
 assert.ok((await page.evaluate(()=>window.adminUI.navigation)).includes('/admin/users'));
 await page.getByRole('button',{name:'Mở menu',exact:true}).click();await page.getByRole('link',{name:'Tổng quan',exact:true}).click();
 result.checks.push('Theme persistence, mobile drawer open/Escape/navigation closure (component router only)');
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Tải lại dịch vụ',exact:true}).click();assert.equal(await page.evaluate(()=>window.adminUI.reloads),1);
 for(const state of ['loading','error','empty']){
  await page.evaluate(value=>window.adminUI.state(value),state);
  if(state==='loading')await page.locator('[aria-busy=true]').first().waitFor();
  if(state==='error'){await page.getByText('Không kết nối được Backend.',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Tải lại dữ liệu',exact:true}).first().click();assert.equal(await page.evaluate(()=>window.adminUI.reloads),2);}
  if(state==='empty')await page.getByRole('heading',{name:'Chưa có dữ liệu',exact:true}).waitFor();
  await page.screenshot({path:`${directory}/state-${state}.png`,fullPage:true});
 }
 result.checks.push('Loading/error/empty presentation; reload/retry callback invoked (no Backend success claimed)');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').length),0);
 assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.locator('iframe').count(),0);
 await page.getByRole('button',{name:'Khám phá robot 3D',exact:true}).click();await page.locator('iframe').waitFor();
 assert.equal(await page.locator('iframe').getAttribute('src'),'/robot/index.html');await page.getByRole('button',{name:'Đóng mô hình / dừng chuyển động',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);
 result.checks.push('Reduced motion: zero running animations; 3D iframe opens/closes on demand (engine not tested)');
 const live=await context.newPage();await live.goto('http://127.0.0.1:3100/admin/dashboard');await live.waitForURL('**/login',{timeout:30000});await live.close();
 result.checks.push('Real Next development route redirects unauthenticated /admin/dashboard to /login');
 assert.deepEqual(result.errors,[]);
 console.log(JSON.stringify(result,null,2));
}finally{
 await writeFile(`${directory}/results.json`,JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));
}
