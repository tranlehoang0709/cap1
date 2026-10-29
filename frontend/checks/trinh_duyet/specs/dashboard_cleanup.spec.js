import {test, expect} from '../fixtures/phien_demo.js';
import {robotFrame, canvasHash} from '../helpers/robot.js';
import {setTheme} from '../helpers/chu_de.js';
import {ensureSidebar, dismissOverlaySidebar} from '../helpers/dieu_huong.js';
import {preserveIdentity, compareIdentity} from '../helpers/vong_doi_iframe.js';

test.use({demoRole:'user'});
for (const width of [390,768,1024,1440]) test(`Dashboard cleanup ${width} @dashboard_cleanup`, async ({page}) => {
  await page.setViewportSize({width,height:1080});
  await expect(page.getByRole('button',{name:'Bắt đầu trò chuyện →',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'＋ Ghép nối robot',exact:true})).toHaveCount(0);
  const frame=await robotFrame(page), identity=await preserveIdentity(frame);
  for (const dark of [false,true]) {
    await ensureSidebar(page);
    await setTheme(page,dark);
    await dismissOverlaySidebar(page);
    await frame.locator('#stage').scrollIntoViewIfNeeded();
    for (const id of ['wave','reset','pause','expression']) await expect(frame.locator(`#${id}`)).toBeHidden();
    await expect(frame.locator('footer')).toContainText('Demo');
    expect(Object.values(await compareIdentity(identity,frame)).every(Boolean)).toBe(true);
    expect(await frame.evaluate(()=>window.__AIVA3D__.rendererInitializations)).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  // Gọi các DOM control nội bộ có sẵn; không thêm API hay panel kiểm thử.
  const before=await frame.evaluate(()=>window.__AIVA3D__.framesRendered);
  await expect.poll(()=>frame.evaluate(()=>window.__AIVA3D__.framesRendered)).toBeGreaterThan(before);
  await frame.evaluate(()=>document.getElementById('wave').click());
  await frame.evaluate(()=>document.getElementById('reset').click());
  await frame.evaluate(()=>document.getElementById('pause').click());
  await expect(frame.locator('#status')).toHaveText('Đã tạm dừng');
  const hashes=[];
  for (const id of ['neutral','happy','angry','sad','sleepy']) {
    await frame.evaluate(id=>{const el=document.getElementById('expression');el.value=id;el.dispatchEvent(new Event('change',{bubbles:true}));},id);
    hashes.push(await canvasHash(frame));
  }
  expect(new Set(hashes).size).toBe(5);
  expect(Object.values(await compareIdentity(identity,frame)).every(Boolean)).toBe(true);
});
