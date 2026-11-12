import {selectTheme,themeButton} from './theme-helpers';
import {test,expect} from '@playwright/test';
import {workspaceEvidence} from '../tests/workspace-evidence';

declare global{interface Window{__pointerCount?:()=>number;__backgroundMounts?:number;__backgroundDisposals?:number;__firstPaintDark?:boolean}}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{
 const listeners=new Set<EventListenerOrEventListenerObject>();const add=window.addEventListener,remove=window.removeEventListener;
 window.addEventListener=function(type:string,listener:EventListenerOrEventListenerObject,options?:boolean|AddEventListenerOptions){if(type==='pointermove'&&listener){listeners.add(listener);if(typeof options==='object'&&options.signal)options.signal.addEventListener('abort',()=>listeners.delete(listener),{once:true});}return add.call(this,type,listener,options);};
 window.removeEventListener=function(type:string,listener:EventListenerOrEventListenerObject,options?:boolean|EventListenerOptions){if(type==='pointermove'&&listener)listeners.delete(listener);return remove.call(this,type,listener,options);};
 window.__pointerCount=()=>listeners.size;window.__backgroundMounts=0;window.__backgroundDisposals=0;document.addEventListener('aiva-background:mounted',()=>window.__backgroundMounts!++);document.addEventListener('aiva-background:disposed',()=>window.__backgroundDisposals!++);
 document.addEventListener('aiva-nova:ready',event=>{window.__nova=(event as CustomEvent).detail.snapshot;});requestAnimationFrame(()=>window.__firstPaintDark=document.documentElement.classList.contains('dark'));
 });});

test('living background obeys focus, parallax, visibility, theme and lifecycle',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/login');await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});
 const bg=page.locator('[data-background="living"]');await expect(bg).toHaveCount(1);await expect(page.locator('[data-background="workspace"]')).toHaveCount(0);expect(await bg.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 await expect(page.locator('main .alert.error')).toHaveCount(0);await expect(page.locator('main')).not.toContainText('Backend');expect(await page.evaluate(()=>window.__pointerCount?.())).toBe(2);
 if(process.env.AIVA_EXPECT_STRICT==='1'){await page.waitForFunction(()=>(window.__backgroundDisposals??0)>=1);expect(await page.evaluate(()=>window.__backgroundMounts)).toBeGreaterThanOrEqual(2);expect(await page.evaluate(()=>window.__pointerCount?.())).toBe(2);}
 const canvas=await page.locator('canvas').elementHandle();const logo=(await page.getByRole('link',{name:'AIVA-IoT trang chủ'}).boundingBox())!,theme=(await themeButton(page).boundingBox())!;expect(Math.abs((logo.y+logo.height/2)-(theme.y+theme.height/2))).toBeLessThan(6);
 if(info.project.name==='desktop'||info.project.name==='wide')expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await page.mouse.move(12,12);await page.mouse.move(1300,500);if(await page.evaluate(()=>matchMedia('(pointer:fine) and (min-width:769px)').matches)){expect(await page.locator('.living-parallax').first().evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41)).not.toBe(0);const animations=await bg.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation).map(a=>a.playState));expect(animations.length).toBeGreaterThan(0);expect(animations).toContain('running');}
 const email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Mật khẩu',{exact:true});await email.fill('ui-only@example.invalid');await expect(bg).toHaveAttribute('data-running','false');await password.fill('ui-only-secret');await expect(page.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode','privacy');
 for(const mode of ['light','dark']){await selectTheme(page,mode);await expect(email).toHaveValue('ui-only@example.invalid');await expect(password).toHaveValue('ui-only-secret');expect(await canvas?.evaluate(el=>el.isConnected)).toBe(true);await expect(page.locator('canvas')).toHaveCount(1);}
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(bg).toHaveAttribute('data-running','false');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('heading',{name:'Trở lại không gian của bạn.'}).click();await expect(bg).toHaveAttribute('data-running','true');
 await page.goto('/admin/dashboard');await expect(page).toHaveURL(/\/login$/);await expect(page.locator('html')).toHaveClass(/dark/);expect(await page.evaluate(()=>window.__firstPaintDark)).toBe(true);await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});expect(await page.evaluate(()=>window.__pointerCount?.())).toBe(2);expect(errors).toEqual([]);
});

test('reduced motion has a static background and keyboard reaches the auth form',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/login');const bg=page.locator('[data-background="living"]');await expect(bg).toHaveAttribute('data-running','false');await page.mouse.move(100,100);await page.mouse.move(500,200);expect(await bg.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation).length)).toBe(0);expect(await page.locator('.living-parallax').first().evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Đến biểu mẫu xác thực'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#auth-form')).toBeFocused();await page.getByLabel('Email',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Mật khẩu',{exact:true})).toBeFocused();
});

test('isolated workspace component surfaces in both themes (not authenticated Dashboard)',async({page,request,baseURL},info)=>{
 const response=await request.get('/login');const source=await response.text();const styles=[...source.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');expect(styles.length).toBeGreaterThan(0);
 for(const admin of [false,true])for(const theme of ['light','dark']){
  await page.setContent(`<!doctype html><html lang="vi" class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><base href="${baseURL}/"/>${styles}</head><body data-evidence="isolated-SSR-component">${workspaceEvidence(admin,'dashboard',theme as 'light'|'dark')}</body></html>`,{waitUntil:'networkidle'});
  await expect(page.locator('[data-background="workspace"]')).toHaveCount(1);await expect(page.locator('[data-background="living"],canvas')).toHaveCount(0);await expect(page.locator('.welcome-band')).toBeVisible();expect(await page.locator('main .skeleton-wrap').count()).toBeGreaterThan(0);
  if(!admin){await expect(page.locator('a[href^="/admin/"]')).toHaveCount(0);await expect(page.locator('.nova-emblem')).toBeVisible();await expect(page.locator('input[name="from"]')).not.toHaveValue('');await expect(page.locator('input[name="to"]')).not.toHaveValue('');}
  else{await expect(page.locator('.admin-ops-panel')).toBeVisible();}
  await expect(page.locator('.heading-mark')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('[data-background="workspace"]').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
  await page.screenshot({path:`test-results/workspace-component-${info.project.name}-${admin?'admin':'user'}-${theme}.png`,fullPage:true});
 }
});

test('register transitions to verify with preserved email and verify transitions to login across 5 viewports',async({page})=>{
 const viewports=[[1920,1080],[1440,900],[1366,768],[820,1180],[390,844]] as const;
 await page.goto('/login');await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});
 for(const [width,height] of viewports){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.route('**/api/auth/register',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,message:'Đã đăng ký. Cần xác minh email trước khi đăng nhập.'})}));
 await page.route('**/api/auth/verify',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true})}));
 await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();
 await page.getByLabel('Họ và tên').fill('Nguyễn Văn A');
 await page.getByLabel('Email',{exact:true}).fill('user@example.invalid');
 await page.getByLabel('Mật khẩu',{exact:true}).fill('ValidPass123!');
 await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('ValidPass123!');
 await page.getByRole('button',{name:'Tạo tài khoản'}).click();
 await expect(page.getByRole('tab',{name:'Xác minh',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('form')).toContainText('user@example.invalid');
 const tokenInput=page.getByLabel('Mã xác minh');
 await tokenInput.fill('header.payload.signature');
 await page.getByRole('button',{name:'Xác minh email'}).click();
 await expect(page.getByRole('tab',{name:'Đăng nhập',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByLabel('Email',{exact:true})).toHaveValue('user@example.invalid');
});
