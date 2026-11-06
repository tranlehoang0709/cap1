/** Browser evidence against the explicit isolated HTTP fixture, never LIVE. */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium, expect} = require(process.env.AIVA_PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.AIVA_RESTORED_URL;
const out = process.env.AIVA_RESTORED_ARTIFACTS;
if (!base?.startsWith('http://127.0.0.1:') || !out) throw Error('Explicit fixture URL/artifact directory required');
const browser = await chromium.launch({channel: 'chrome', headless: true});
const result = {fixtureOnly:true, browser:browser.version(), views:[], robots:[], errors:[]};
let active;
async function settle(page) {
  await expect(page.getByTestId('stException')).toHaveCount(0);
  const busy=page.getByTestId('stStatusWidget');
  if(await busy.count()) await busy.waitFor({state:'hidden',timeout:30000});
  await expect(page.getByTestId('stException')).toHaveCount(0);
  // Streamlit streams deltas after the page heading changes. A DOM quiet
  // interval prevents screenshots of grey, stale content from the last route.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const root=document.querySelector('[data-testid="stAppViewContainer"]');
    let quiet, deadline;
    const done=()=>{observer.disconnect();clearTimeout(deadline);resolve();};
    const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,350);});
    observer.observe(root,{childList:true,subtree:true,characterData:true});
    quiet=setTimeout(done,350);
    deadline=setTimeout(()=>{observer.disconnect();clearTimeout(quiet);reject(Error('Streamlit DOM did not settle'));},30000);
  }));
}
async function sidebar(page) {
  const side=page.getByTestId('stSidebar');
  const box=await side.boundingBox();
  if(await page.getByTestId('stExpandSidebarButton').isVisible())
    await page.getByTestId('stExpandSidebarButton').click();
  await expect(side).toBeInViewport({ratio:0.5});
  return side;
}
async function closeOverlay(page) {
  const side=page.getByTestId('stSidebar');
  const s=await side.boundingBox(), m=await page.getByTestId('stMain').boundingBox();
  if(s && m && m.x<s.x+s.width-1) {
    await side.getByTestId('stSidebarCollapseButton').getByRole('button').click();
    await expect(side).not.toBeInViewport();
  }
}
async function navigate(page, label) {
  const side=await sidebar(page);
  await side.getByText(label,{exact:true}).click();
  await expect(page.locator('.st-key-portal_page_header h1')).toHaveText(label);
  await settle(page);
  await closeOverlay(page);
}
async function record(page, width, role, label) {
  await settle(page);
  const overflow=await page.evaluate(()=>{
    const main=document.querySelector('[data-testid="stMain"]');
    return {document:document.documentElement.scrollWidth>innerWidth+2,
            main:main ? main.scrollWidth>main.clientWidth+2 : false};
  });
  if(overflow.document || overflow.main) throw Error('Horizontal overflow: '+JSON.stringify({width,role,label,overflow}));
  await page.screenshot({path:path.join(out,role+'-'+width+'-'+label+'.png'),fullPage:true});
  result.views.push({width,role,page:label,overflow});
}
async function robotEvidence(page, label) {
  const frames=page.frames().filter(f=>f.url()==='about:srcdoc');
  if(!frames.length) throw Error('Robot iframe missing: '+label);
  const frame=frames[0];
  const host=await frame.frameElement();
  await host.scrollIntoViewIfNeeded();
  await frame.waitForFunction(()=>window.__AIVA3D__?.rendererInitialized && window.__AIVA3D__.framesRendered>0,{timeout:20000});
  const evidence=await frame.evaluate(()=>{
    const d=window.__AIVA3D__, canvas=document.querySelector('canvas'), gl=canvas.getContext('webgl2');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {...d, width:canvas.clientWidth,height:canvas.clientHeight,
            gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable'};
  });
  if(evidence.threeRevision!=='180' || evidence.lastError || evidence.drawCalls<1)
    throw Error('Robot initialization failed: '+JSON.stringify(evidence));
  result.robots.push({label,...evidence});
  return frame;
}
try {
  for(const width of [390,768,1024,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1,locale:'vi-VN'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      return url.hostname==='127.0.0.1'||url.protocol==='about:' ? route.continue() : route.abort();
    });
    active=await context.newPage();
    active.on('pageerror',error=>result.errors.push(String(error)));
    await active.goto(base);
    await expect(active.getByRole('heading',{name:'Chào mừng đến AIVA-IoT',exact:true})).toBeVisible();
    await record(active,width,'login','login');
    await robotEvidence(active,'login-'+width);
    await active.getByLabel('Email',{exact:true}).fill('user@fixture.invalid');
    await active.locator('input[autocomplete="current-password"]').fill('fixture-only');
    await active.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await expect(active.locator('.st-key-portal_page_header h1')).toHaveText('Tổng quan');
    await closeOverlay(active);
    const userPages=['Tổng quan','AI Chat','Robot của tôi','Trợ lý AI','API Key cá nhân','Lịch sử hội thoại','Quyền riêng tư','Tài khoản'];
    for(let i=0;i<userPages.length;i++) {
      await navigate(active,userPages[i]);
      if(i===1) await expect(active.locator('.st-key-chat_main').getByRole('heading',{name:'Fixture AIVA',exact:true})).toBeVisible();
      await record(active,width,'user','page-'+i);
      if(i===0) {
        const side=await sidebar(active);
        await side.getByLabel('Chế độ tối',{exact:true}).press('Space');
        await settle(active);
        await closeOverlay(active);
        await expect(active.locator(':root')).toHaveCSS('color-scheme','light');
        await record(active,width,'user','dashboard-light');
        const themed=await robotEvidence(active,'dashboard-light-'+width);
        await expect.poll(()=>themed.evaluate(()=>window.__AIVA3D__.theme)).toBe('light');
        const darkSide=await sidebar(active);
        await darkSide.getByLabel('Chế độ tối',{exact:true}).press('Space');
        await settle(active);
        await closeOverlay(active);
      }
      if(i===3) await expect(active.locator('iframe')).toHaveCount(0);
      if(i===2) {
        const frame=await robotEvidence(active,'devices-'+width);
        await frame.locator('#expression').selectOption('happy');
        const canvas=frame.locator('canvas'), box=await canvas.boundingBox();
        await active.mouse.move(box.x+box.width*.45,box.y+box.height*.5);
        await active.mouse.down();
        await active.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:8});
        await active.mouse.up();
        await active.mouse.wheel(0,-100);
        await canvas.dblclick();
        await expect(frame.locator('#status')).not.toContainText('lỗi');
        await active.emulateMedia({reducedMotion:'reduce'});
        await expect(frame.locator('#status')).toContainText('Giảm chuyển động');
        await active.emulateMedia({reducedMotion:'no-preference'});
        await active.getByLabel('Tạm dừng chuyển động robot',{exact:true}).press('Space');
        await settle(active);
        const pausedFrame=await robotEvidence(active,'paused-devices-'+width);
        await expect(pausedFrame.locator('#status')).toContainText('Đã tạm dừng');
        await active.getByLabel('Tạm dừng chuyển động robot',{exact:true}).press('Space');
        await settle(active);
      }
    }
    await navigate(active,'AI Chat');
    await active.getByTestId('stChatInputTextArea').fill('Synthetic browser fixture question');
    await active.getByTestId('stChatInputTextArea').press('Enter');
    await expect(active.getByText('Fixture browser answer. No provider was called.',{exact:true})).toBeVisible();
    const side=await sidebar(active);
    await side.getByRole('button',{name:'Đăng xuất',exact:true}).click();
    await expect(active.getByRole('heading',{name:'Chào mừng đến AIVA-IoT',exact:true})).toBeVisible();
    await active.getByLabel('Email',{exact:true}).fill('admin@fixture.invalid');
    await active.locator('input[autocomplete="current-password"]').fill('fixture-only');
    await active.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await expect(active.locator('.st-key-portal_page_header h1')).toHaveText('Tổng quan');
    for(const [i,label] of ['Tổng quan','Quản lý người dùng','Quản lý thiết bị','AI Management','API Key & Quota','OTA Firmware','Logs & Monitoring','System Settings'].entries()) {
      await navigate(active,label);
      await record(active,width,'admin','page-'+i);
    }
    console.log(JSON.stringify({width,views:result.views.length,robotCases:result.robots.length}));
    await context.close();
  }
  if(result.errors.length) throw Error('Browser JS errors: '+result.errors.join('; '));
  result.status='PASS';
} catch(error) {
  result.status='FAIL';
  result.failure=String(error);
  if(active && !active.isClosed()) await active.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));
  await browser.close();
}
