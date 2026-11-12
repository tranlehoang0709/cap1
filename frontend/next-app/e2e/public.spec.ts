import {selectTheme,themeButton} from './theme-helpers';
import { test, expect } from '@playwright/test';
test('verification link is consumed locally and never submitted automatically',async({page})=>{
 const calls:string[]=[];page.on('request',r=>{if(r.url().includes('/api/auth/verify'))calls.push(r.url());});
 await page.goto('/login#verify-email=unitTestHeader.unitTestPayload.unitTestSignature');
 await expect(page.getByLabel('Mã xác minh')).toHaveValue('unitTestHeader.unitTestPayload.unitTestSignature');
 await expect(page).toHaveURL(/\/login$/);
 expect(calls).toEqual([]);
});
test('public API rejects malformed input without contacting Backend', async ({ request,baseURL }) => {
    const headers = { Origin: baseURL! };
    const invalid = await request.post('/api/auth/register', { headers, data: { email: 'invalid', display_name: '', password: 'short' } });
    expect(invalid.status()).toBe(400);
    const malformed = await request.post('/api/auth/login', { headers: { ...headers, 'Content-Type': 'application/json' }, data: '{' });
    expect(malformed.status()).toBe(400);
    expect((await request.get('/api/auth/unknown')).status()).toBe(404);
});
test('login, themes and registration render without overflow', async ({ page }) => { await page.goto('/login'); await expect(page.getByRole('heading', { name: 'Trở lại không gian của bạn.' })).toBeVisible(); await selectTheme(page,'dark'); await expect(page.locator('html')).toHaveClass(/dark/); await page.getByRole('tab', { name: 'Đăng ký', exact: true }).click(); await expect(page.getByLabel('Họ và tên')).toBeVisible(); await page.getByRole('tab', { name: 'Xác minh', exact: true }).click(); await expect(page.getByLabel('Mã xác minh')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); await page.screenshot({ path: `test-results/login-${test.info().project.name}.png`, fullPage: true }); });
test('protected pages redirect and BFF rejects unauthenticated requests', async ({ page, request,baseURL }) => { await page.goto('/admin/robots'); await expect(page).toHaveURL(/\/login$/); const r = await request.post('/api/backend', { headers: { Origin: baseURL! }, data: { operation: 'systemKeys' } }); expect(r.status()).toBe(401); const cross = await request.post('/api/backend', { headers: { Origin: 'https://untrusted.invalid' }, data: { operation: 'dashboard' } }); expect(cross.status()).toBe(403); });
test('reduced motion and keyboard focus remain available', async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/login'); await expect(themeButton(page)).toHaveAttribute('data-hydrated','true'); const email=page.getByRole('textbox',{name:'Email',exact:true});await email.focus();await expect(email).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByLabel('Mật khẩu',{exact:true}).filter({visible:true})).toBeFocused(); });
