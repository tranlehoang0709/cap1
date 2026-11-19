import {test,expect,type Page} from '@playwright/test';
test.skip(!process.env.AIVA_FIXTURE_ORIGIN,'Explicit isolated Backend fixture required; never run mutations against a live service.');
async function login(page:Page,role:'user'|'admin'){
 await page.goto('/login');
 const response=await page.request.post('/api/auth/login',{headers:{Origin:new URL(page.url()).origin},data:{email:`${role}@example.invalid`,password:'fixture-password'}});
 expect(response.status()).toBe(200);expect(await response.json()).toEqual({success:true});
 await page.goto(`/${role}/dashboard`);
 await expect(page.locator(`.app-shell[data-portal="${role}"]`)).toHaveCount(1);
 await expect(page.locator(`.app-shell[data-portal="${role}"]`)).toBeVisible();
}
async function call(page:Page,data:object){return page.request.post('/api/backend',{headers:{Origin:new URL(page.url()).origin},data});}

test('fixture: multi-turn Chat preserves messages, supports Shift+Enter/IME, and retries failed input',async({page})=>{
 await login(page,'user');await page.goto('/user/chat');const input=page.getByRole('textbox',{name:'Nội dung tin nhắn'});await expect(input).toBeEnabled();
 await input.fill('first');await input.press('Shift+Enter');expect(await input.inputValue()).toBe('first\n');
 await input.fill('Tiếng Việt');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.locator('.chat-bubble')).toHaveCount(0);
 await input.press('Enter');await expect(page.locator('.chat-bubble.assistant')).toContainText('Fixture reply: Tiếng Việt');
 await input.fill('second');await input.press('Enter');await expect(page.locator('.chat-bubble')).toHaveCount(4);
 await input.fill('retry fixture');await input.press('Enter');await expect(page.locator('.alert.error')).toContainText('Fixture chat failure');await expect(input).toHaveValue('retry fixture');
 await input.press('Enter');await expect(page.locator('.chat-bubble')).toHaveCount(6);await expect(page.locator('.chat-bubble.assistant').last()).toContainText('Fixture reply: retry fixture');
});

test('fixture: User pairing stays pending, modal traps/restores focus, RBAC rejects admin operations',async({page})=>{
 await login(page,'user');await page.goto('/user/robots');const trigger=page.getByRole('button',{name:'Nhập mã ghép nối'});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('checkbox')).toHaveCount(0);await dialog.getByLabel('Mã ghép nối').fill('a'.repeat(32));
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await page.getByLabel('Mã ghép nối').fill('a'.repeat(32));await page.getByRole('button',{name:'Xác nhận',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('cell',{name:'PENDING',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Cấp mã|Duyệt|Recovery|Khôi phục/})).toHaveCount(0);
 for(const operation of ['pairingCode','approve','revoke','restore','settingSave'])expect((await call(page,{operation,params:{id:'1',key:'platform.default_locale'},body:{}})).status()).toBe(403);
 const cookies=await page.context().cookies();const session=cookies.find(c=>c.name==='aiva_session')!;expect(session.httpOnly).toBe(true);expect(session.sameSite).toBe('Lax');expect(session.value).not.toContain('USER');
});

test('fixture: Admin pairing code, protected settings and Recovery honor BFF rules without fake ACK',async({page})=>{
 await login(page,'admin');await expect(page.locator('.admin-ops-panel')).toBeVisible();await expect(page.locator('.metric-card')).toHaveCount(4);await expect(page.locator('.admin-dashboard .alert.error')).toHaveCount(0);
 await page.goto('/admin/settings');await expect(page.getByRole('cell',{name:'platform.default_locale',exact:true})).toBeVisible();await expect(page.getByText('recovery.reset.1.challenge',{exact:true})).toHaveCount(0);
 expect((await call(page,{operation:'settingSave',params:{key:'recovery.reset.1.challenge'},body:{value:{}}})).status()).toBe(403);
 expect((await call(page,{operation:'settingSave',params:{key:'platform.default_locale'},body:{value:'vi'}})).status()).toBe(200);
 const result=await call(page,{operation:'pairingCode',params:{id:'1'},body:{ttl_minutes:10}});expect((await result.json()).pairing_code).toBe('a'.repeat(32));
 await page.goto('/admin/robots');await page.getByRole('button',{name:'Recovery',exact:true}).click();await expect(page.getByText('ADMIN_RECOVERY_REQUIRED',{exact:true}).last()).toBeVisible();await expect(page.getByRole('button',{name:/Xác nhận ACK|Gửi ACK/})).toHaveCount(0);
 const status=await call(page,{operation:'resetStatus',params:{id:'1'}});expect(await status.json()).toEqual({status:'ADMIN_RECOVERY_REQUIRED'});
 const ledger=await (await page.request.get(process.env.AIVA_FIXTURE_ORIGIN+'/__fixture/requests')).json();expect(ledger.some((r:{path:string})=>/acknowledge|\/revoke$|\/restore$/.test(r.path))).toBe(false);
});

test('fixture: usage date inputs match applied query and companion poses fit the dashboard',async({page})=>{
 await login(page,'user');const from=page.locator('input[name="from"]'),to=page.locator('input[name="to"]');await expect(from).not.toHaveValue('');await expect(to).not.toHaveValue('');
 await from.fill('2026-11-01');await to.fill('2026-11-12');const query=page.waitForRequest(req=>req.url().endsWith('/api/backend')&&req.postDataJSON().operation==='usage');
 await page.getByRole('button',{name:'Áp dụng'}).click();const sent=(await query).postDataJSON().query;expect(sent).toEqual(await page.evaluate(()=>({from:new Date('2026-11-01T00:00:00').toISOString(),to:new Date('2026-11-12T23:59:59').toISOString()})));
 await page.getByRole('button',{name:'Khám phá NOVA 3D'}).click();const companion=page.locator('.nova-companion-stage');await companion.scrollIntoViewIfNeeded();await expect(companion.locator('[data-nova-status="ready"]')).toBeVisible({timeout:30000});
 await companion.getByRole('button',{name:'Suy nghĩ',exact:true}).click();await expect(companion.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode','thinking');
 await companion.getByRole('button',{name:'Chào hỏi',exact:true}).click();await expect(companion.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode','greeting');
 await companion.getByRole('button',{name:'Bình thường',exact:true}).click();await expect(companion.locator('[data-smart-mode]')).toHaveAttribute('data-smart-mode','idle');await page.waitForTimeout(5500);await expect(companion.locator('[data-beast-mode]')).toHaveAttribute('data-beast-mode','normal');
 const box=(await companion.locator('canvas').boundingBox())!;expect(box.height).toBe(200);expect(await page.locator('canvas').count()).toBe(1);
});

test('fixture: PA-10/11/12 personal task management, priority update, and multi-session plan progress',async({page})=>{
 await login(page,'user');
 const pa=page.getByTestId('personal-assistant-workspace');
 await expect(pa).toBeVisible();

 // PA-12 initial multi-session progress: 3/10 sessions (30%), remaining 7 sessions, partial session 4 not completed
 await expect(pa.getByTestId('plan-10-completed')).toContainText('Completed: 3/10 sessions.');
 await expect(pa.getByTestId('plan-10-progress')).toContainText('Progress: 30%.');
 await expect(pa.getByTestId('plan-10-remaining')).toContainText('Remaining: 7 sessions.');
 await expect(pa.locator('[data-session-id="4"]')).toHaveAttribute('data-session-completed','false');

 // PA-10 create new task: "Hoàn thành báo cáo đồ án trước 17:00 ngày mai."
 await pa.getByRole('button',{name:'Tạo công việc mới'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 await dialog.locator('input[name="title"]').fill('Hoàn thành báo cáo đồ án trước 17:00 ngày mai.');
 await dialog.locator('textarea[name="description"]').fill('Nộp báo cáo chương 4 và chương 5.');
 await dialog.locator('select[name="priority"]').selectOption('MEDIUM');
 await dialog.locator('select[name="plan_id"]').selectOption('10');
 await dialog.locator('input[name="session_number"]').fill('4');
 await dialog.getByRole('button',{name:'Lưu công việc'}).click();
 await expect(dialog).toHaveCount(0);

 await expect(pa.getByText('Hoàn thành báo cáo đồ án trước 17:00 ngày mai.')).toBeVisible();

 // PA-11 update priority without losing task info
 await pa.getByRole('button',{name:'Đổi ưu tiên Hoàn thành báo cáo đồ án trước 17:00 ngày mai.'}).click();
 const prioDialog=page.getByRole('dialog');
 await prioDialog.locator('select[name="priority"]').selectOption('HIGH');
 await prioDialog.getByRole('button',{name:'Xác nhận đổi ưu tiên'}).click();
 await expect(prioDialog).toHaveCount(0);
 await expect(pa.locator('tr',{hasText:'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.'}).locator('[data-priority="HIGH"]')).toBeVisible();
 await expect(pa.locator('tr',{hasText:'Hoàn thành báo cáo đồ án trước 17:00 ngày mai.'})).toContainText('Nộp báo cáo chương 4 và chương 5.');

 // PA-10 & PA-12 mark task completed and complete session 4 -> 4/10 sessions (40%)
 await pa.getByRole('button',{name:'Hoàn thành Hoàn thành báo cáo đồ án trước 17:00 ngày mai.'}).click();
 await expect(pa.getByTestId('pa-completed-tasks')).toHaveText('2');
 await pa.getByRole('button',{name:'Hoàn thành buổi 4 của Kế hoạch đồ án 10 buổi'}).click();
 await expect(pa.getByTestId('plan-10-completed')).toContainText('Completed: 4/10 sessions.');
 await expect(pa.getByTestId('plan-10-progress')).toContainText('Progress: 40%.');
 await expect(pa.getByTestId('plan-10-remaining')).toContainText('Remaining: 6 sessions.');
});
