import {selectTheme} from './theme-helpers';
import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {NovaSnapshot} from '../src/components/robot/engine/scene';
import type {SmartOutput} from '../src/components/robot/NovaInteractionController';
type Snapshot=NovaSnapshot&{smart:SmartOutput;audio:{enabled:boolean;state:string;voices:number;played:number}};
declare global{interface Window{__nova?:()=>Snapshot;__novaDisposed?:Array<NovaSnapshot&{audioState:string}>}}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{window.__novaDisposed=[];document.addEventListener('aiva-nova:ready',event=>{window.__nova=(event as CustomEvent).detail.snapshot;});document.addEventListener('aiva-nova:disposed',event=>{window.__novaDisposed?.push((event as CustomEvent).detail);});});});
const snapshot=(page:Page)=>page.evaluate(()=>window.__nova!());
const mode=(page:Page,value:string)=>expect(page.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode',value);
async function ready(page:Page){await page.goto('/login');await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});await page.waitForFunction(()=>(window.__nova?.().frames??0)>1);}

test('smart focus, privacy, original robot click/camera and Light/Dark responsive screenshots',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text()+' '+e.location().url);});await ready(page);
 const area=page.getByRole('region',{name:'AIVA NOVA 3D'});await expect(page.locator('iframe,.robot-poster')).toHaveCount(0);await expect(page.locator('canvas')).toHaveCount(1);
 for(const name of ['Chào','Nhảy','Ăn mừng','Phản ứng','Idle','Chớp mắt','Reset','SFX ON','SFX OFF','Tạm dừng','Tiếp tục'])await expect(area.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(area.getByRole('slider')).toHaveCount(0);await expect(area.getByRole('combobox')).toHaveCount(0);
 const email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Mật khẩu',{exact:true});await email.focus();await mode(page,'email');await email.fill('ui-only@example.invalid');await mode(page,'email');
 await password.fill('ui-only-secret');await mode(page,'privacy');await page.waitForFunction(()=>(window.__nova?.().interaction.privacy??0)>.95);const privatePose=await snapshot(page);expect(privatePose.head[1]).toBeLessThan(-.5);expect(privatePose.smart.tracking).toBe(false);
 await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click();await expect(password).toHaveAttribute('type','text');await mode(page,'privacy');await page.getByRole('button',{name:'Ẩn mật khẩu',exact:true}).click();await mode(page,'privacy');
 await page.mouse.move(15,15);expect((await snapshot(page)).smart.mode).toBe('privacy');expect(JSON.stringify(await snapshot(page))).not.toContain('ui-only-secret');expect(JSON.stringify(await snapshot(page))).not.toContain('ui-only@example.invalid');
 await email.focus();await mode(page,'email');await email.blur();await mode(page,'idle');await password.fill('');await password.blur();await email.fill('');await email.blur();await mode(page,'idle');
 await area.locator('canvas').scrollIntoViewIfNeeded();const box=(await area.locator('canvas').boundingBox())!;await page.mouse.move(box.x+box.width*.5,box.y+box.height*.65);const before=await snapshot(page);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+25,box.y+box.height*.65+5,{steps:6});await page.mouse.up();await page.waitForTimeout(150);expect((await snapshot(page)).camera).not.toEqual(before.camera);
 const point=(await snapshot(page)).hitPoint;await area.locator('canvas').click({position:point});await mode(page,'reaction');expect((await snapshot(page)).action).toBe('react');
 for(const view of ['login','register']){if(view==='register')await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();for(const theme of ['light','dark']){await selectTheme(page,theme);await expect(page.locator('html')).toHaveClass(new RegExp(theme));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/nova-${info.project.name}-${view}-${theme}.png`,fullPage:true});}}
 if(info.project.name==='mobile'){await page.getByRole('tab',{name:'Đăng nhập',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));const submit=(await page.getByRole('button',{name:'Đăng nhập',exact:true}).boundingBox())!;expect(submit.y+submit.height).toBeLessThan(844);}
 await writeFile(`test-results/nova-${info.project.name}-metrics.json`,JSON.stringify({viewport:page.viewportSize(),snapshot:await snapshot(page),canvasCount:await page.locator('canvas').count(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),consoleErrors:errors},null,2));
 expect(errors).toEqual([]);
});

test('registration validation blocks mismatch and preserves the actual request DTO',async({page})=>{
 await ready(page);await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await page.getByLabel('Họ và tên').fill('UI test');await page.getByLabel('Email',{exact:true}).fill('ui-only@example.invalid');await page.getByLabel('Mật khẩu',{exact:true}).fill('abcdefgh123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('different123');await mode(page,'privacy');
 let calls=0;page.on('request',r=>{if(r.url().includes('/api/auth/register'))calls++;});await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toContainText('không khớp');await mode(page,'confused');expect(calls).toBe(0);
 await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('abcdefgh123');await mode(page,'privacy');await page.getByLabel('Email',{exact:true}).focus();await mode(page,'email');
 let keys:string[]=[];await page.route('**/api/auth/register',route=>{keys=Object.keys(route.request().postDataJSON()).sort();return route.abort('failed');});await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toContainText('Mất kết nối');expect(keys).toEqual(['display_name','email','password']);await mode(page,'worried');
});

test('pending and network failure UI under explicit transport fault injection (not live auth)',async({page})=>{
 await ready(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);await page.route('**/api/auth/login',async route=>{await gate;await route.abort('failed');});
 await page.getByLabel('Email',{exact:true}).fill('ui-only@example.invalid');await page.getByLabel('Mật khẩu',{exact:true}).fill('ui-only-secret');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await mode(page,'thinking');await expect(page.locator('form')).toHaveAttribute('aria-busy','true');await expect(page.getByRole('tab',{name:'Đăng ký',exact:true})).toBeDisabled();expect((await snapshot(page)).action).toBe('idle');release();
 await expect(page.locator('form').getByRole('alert')).toContainText('Mất kết nối');await mode(page,'worried');expect((await snapshot(page)).action).not.toBe('celebrate');await expect(page).toHaveURL(/\/login$/);
});

test('cleanup after unmount and safe remount (also run against dev Strict Mode)',async({page})=>{
 await ready(page);const area=page.getByRole('region',{name:'AIVA NOVA 3D'});if(process.env.AIVA_EXPECT_STRICT==='1')await page.waitForFunction(()=>window.__novaDisposed!.length>=1);
 for(let i=0;i<2;i++){if(i===0){await area.getByRole('button',{name:'Bật âm thanh NOVA',exact:true}).click();await page.waitForFunction(()=>window.__nova?.().audio.state==='running');await area.locator('canvas').focus();await page.keyboard.press('Enter');expect((await snapshot(page)).audio.played).toBeGreaterThan(0);await area.getByRole('button',{name:'Tắt âm thanh NOVA',exact:true}).click();expect((await snapshot(page)).audio.voices).toBe(0);await area.getByRole('button',{name:'Bật âm thanh NOVA',exact:true}).click();}
  await area.getByRole('button',{name:'Ẩn NOVA 3D',exact:true}).click();await expect(area.locator('canvas')).toHaveCount(0);await page.waitForFunction(()=>window.__novaDisposed!.length>0);const disposed=await page.evaluate(()=>window.__novaDisposed!);if(i===0)expect(disposed.some(entry=>entry.audioState==='closed')).toBe(true);
  for(const entry of disposed){expect(entry.disposed).toBe(true);expect(entry.memory.geometries).toBe(0);expect(entry.memory.textures).toBe(0);expect(['closed','uninitialized']).toContain(entry.audioState);}
  await area.getByRole('button',{name:'Hiện NOVA 3D',exact:true}).click();await area.locator('canvas').scrollIntoViewIfNeeded();await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});await expect(page.locator('canvas')).toHaveCount(1);
 }
});

test('reduced motion and privacy remain safe without autoplay audio',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await ready(page);await page.getByLabel('Email',{exact:true}).focus();await page.getByLabel('Email',{exact:true}).blur();await page.waitForTimeout(100);const a=await snapshot(page);await page.waitForTimeout(200);expect((await snapshot(page)).pose).toEqual(a.pose);expect(a.reduced).toBe(true);expect(a.audio.state).toBe('uninitialized');
 await page.getByLabel('Mật khẩu',{exact:true}).focus();await mode(page,'privacy');await page.waitForFunction(()=>window.__nova?.().interaction.privacy===1);expect((await snapshot(page)).audio.state).toBe('uninitialized');
});

test('WebGL failure preserves functional auth form',async({page})=>{await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){if(type.includes('webgl'))return null;return original.apply(this,[type,...args] as Parameters<typeof original>);} as typeof original;});await page.goto('/login');await expect(page.locator('[data-nova-status="error"]')).toBeVisible({timeout:30000});await page.getByLabel('Email',{exact:true}).fill('form@example.invalid');await expect(page.getByRole('button',{name:'Đăng nhập',exact:true})).toBeEnabled();await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await expect(page.getByLabel('Họ và tên')).toBeVisible();});

test('Beast Mode activates after 5s idle, flexes double-biceps without covering form, and interrupts mid-transformation or at full flex',async({page},info)=>{
 await ready(page);
 const email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Mật khẩu',{exact:true});
 // Focus and blur email to enter clean idle state immediately (canceling initial greeting wave)
 await email.focus();
 await email.blur();
 await expect(page.locator('[data-beast-mode]')).toHaveAttribute('data-beast-mode','normal');

 // Wait until mid-transformation (0.15 < progress < 0.85) and interrupt immediately
 await page.waitForFunction(()=>{const p=window.__nova?.().beast.progress??0;return p>0.15&&p<0.85;},{timeout:8000});
 const midSnap=await snapshot(page);
 expect(midSnap.bounds.clipped).toBe(false);
 await email.focus();
 await mode(page,'email');
 await expect(page.locator('[data-beast-mode]')).toHaveAttribute('data-beast-mode','normal');
 await page.waitForFunction(()=>(window.__nova?.().beast.progress??1)===0,{timeout:3000});

 // Blur and wait 5s + transform duration for full Beast Mode
 await email.blur();
 await expect(page.locator('[data-beast-mode]')).toHaveAttribute('data-beast-mode','beast',{timeout:8000});
 await page.waitForFunction(()=>(window.__nova?.().beast.progress??0)===1,{timeout:4000});
 const beastSnap=await snapshot(page);
 expect(beastSnap.beast.state).toBe('beast');
 expect(beastSnap.beast.headScale).toEqual([1,1,1]);
 expect(beastSnap.beast.shoulderSpan).toBeGreaterThan(2.6);
 expect(beastSnap.bounds.clipped).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(info.project.name==='desktop'){
  await page.screenshot({path:'test-results/nova-desktop-login-beast-dark.png',fullPage:true});
  for(const vp of [{name:'1920x1080',width:1920,height:1080},{name:'1440x900',width:1440,height:900},{name:'1366x768',width:1366,height:768},{name:'820x1180',width:820,height:1180}]){
   await page.setViewportSize({width:vp.width,height:vp.height});
   await page.waitForTimeout(250);
   const vpSnap=await snapshot(page);
   expect(vpSnap.bounds.clipped).toBe(false);
   const h1Box=(await page.locator('.auth-intro h1').boundingBox())!;
   const canvasBox=(await page.locator('[aria-label="AIVA NOVA 3D"] canvas').boundingBox())!;
   const headScreenX=canvasBox.x+vpSnap.hitPoint.x;
   const headScreenY=canvasBox.y+vpSnap.hitPoint.y;
   const headOverlapsH1=headScreenX>=h1Box.x-15&&headScreenX<=h1Box.x+h1Box.width+15&&headScreenY>=h1Box.y-15&&headScreenY<=h1Box.y+h1Box.height+15;
   expect(headOverlapsH1).toBe(false);
   await page.screenshot({path:`test-results/nova-beast-${vp.name}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  await selectTheme(page,'light');
  await page.waitForFunction(()=>(window.__nova?.().beast.progress??0)===1,{timeout:8000});
  expect((await snapshot(page)).bounds.clipped).toBe(false);
  await page.screenshot({path:'test-results/nova-desktop-login-beast-light.png',fullPage:true});
 }else{
  await page.screenshot({path:'test-results/nova-beast-390x844.png',fullPage:true});
 }

 // Ensure form is not covered and focusing password immediately shrinks Beast Mode & triggers privacy pose
 await password.click();
 await mode(page,'privacy');
 await expect(page.locator('[data-beast-mode]')).toHaveAttribute('data-beast-mode','normal');
 await page.waitForFunction(()=>(window.__nova?.().beast.progress??1)===0&&(window.__nova?.().interaction.privacy??0)>.95,{timeout:4000});
});
