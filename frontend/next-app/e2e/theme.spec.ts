import {test,expect} from '@playwright/test';
import {selectTheme,themeButton} from './theme-helpers';

declare global{interface Window{__themeAtFirstPaint?:string}}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{requestAnimationFrame(()=>window.__themeAtFirstPaint=document.documentElement.className);});});
const ready=async(page:import('@playwright/test').Page)=>{await expect(page.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});};

test('default dark and legacy system migration happen before first paint, with one button',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});
 await page.addInitScript(()=>{const seed=new URL(location.href).searchParams.get('themeSeed');if(seed==='none')localStorage.removeItem('theme');else if(seed)localStorage.setItem('theme',seed);});
 for(const seed of ['none','system','invalid','light','dark']){
  await page.goto(`/login?themeSeed=${seed}`);await ready(page);const mode=seed==='light'?'light':'dark';
  await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^| )${mode}(?: |$)`));expect(await page.evaluate(()=>localStorage.getItem('theme'))).toBe(mode);expect(await page.evaluate(()=>window.__themeAtFirstPaint)).toMatch(new RegExp(`(?:^| )${mode}(?: |$)`));
  await expect(themeButton(page)).toHaveCount(1);await expect(themeButton(page)).toHaveAttribute('data-theme-mode',mode);await expect(themeButton(page)).toHaveText(mode==='dark'?'Tối':'Sáng');await expect(page.locator('select,option')).toHaveCount(0);
 }
});

test('theme click, Enter, Space, reload and navigation preserve state without remounting NOVA',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/login');await ready(page);await selectTheme(page,'light');
 const canvas=await page.locator('canvas').elementHandle();const email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Mật khẩu',{exact:true});await email.fill('ui-only@example.invalid');await password.fill('ui-only-secret');
 await themeButton(page).click();await expect(themeButton(page)).toHaveText('Tối');await expect(themeButton(page).locator('svg')).toHaveClass(/lucide-moon/);
 await themeButton(page).focus();await page.keyboard.press('Enter');await expect(themeButton(page)).toHaveText('Sáng');await expect(themeButton(page).locator('svg')).toHaveClass(/lucide-sun/);
 await page.keyboard.press('Space');await expect(themeButton(page)).toHaveText('Tối');await expect(email).toHaveValue('ui-only@example.invalid');await expect(password).toHaveValue('ui-only-secret');expect(await canvas?.evaluate(el=>el.isConnected)).toBe(true);await expect(page.locator('canvas')).toHaveCount(1);
 await selectTheme(page,'light');await page.getByRole('tab',{name:'Đăng ký',exact:true}).click();await expect(themeButton(page)).toHaveText('Sáng');await page.reload();await ready(page);await expect(themeButton(page)).toHaveText('Sáng');expect(await page.evaluate(()=>window.__themeAtFirstPaint)).toMatch(/light/);
 await page.goto('/user/dashboard');await expect(page).toHaveURL(/\/login$/);await ready(page);await expect(themeButton(page)).toHaveText('Sáng');expect(await page.evaluate(()=>window.__themeAtFirstPaint)).toMatch(/light/);expect(errors).toEqual([]);
});

test('unavailable local storage leaves a usable dark default and functional toggle',async({page})=>{
 await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(this===window.localStorage)throw new DOMException('Unavailable','SecurityError');return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(this===window.localStorage)throw new DOMException('Unavailable','SecurityError');return set.call(this,key,value);};});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/login');await ready(page);await expect(themeButton(page)).toHaveText('Tối');await themeButton(page).click();await expect(themeButton(page)).toHaveText('Sáng');await page.getByLabel('Email',{exact:true}).fill('usable@example.invalid');expect(errors).toEqual([]);
});

test('cross-tab legacy storage is repaired without resetting the form or following OS theme',async({page,context})=>{
 await page.emulateMedia({colorScheme:'light'});await page.goto('/login');await ready(page);await selectTheme(page,'light');await page.getByLabel('Email',{exact:true}).fill('ui-only@example.invalid');const second=await context.newPage();
 try{await second.goto('/login');await ready(second);await expect(themeButton(second)).toHaveText('Sáng');await second.evaluate(()=>localStorage.setItem('theme','system'));await expect(themeButton(page)).toHaveText('Tối');await expect(themeButton(second)).toHaveText('Tối');expect(await page.evaluate(()=>localStorage.getItem('theme'))).toBe('dark');await expect(page.getByLabel('Email',{exact:true})).toHaveValue('ui-only@example.invalid');}finally{await second.close();}
});
