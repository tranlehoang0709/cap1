import {test, expect} from '../fixtures/phien_demo.js';
import {robotFrame} from '../helpers/robot.js';
import {setTheme} from '../helpers/chu_de.js';
import {preserveIdentity, compareIdentity} from '../helpers/vong_doi_iframe.js';
import {runDir} from '../helpers/moi_truong.js';
import path from 'node:path';
import {ensureSidebar, dismissOverlaySidebar} from '../helpers/dieu_huong.js';

// Dashboard/hero ẩn UI theo thiết kế đã duyệt; vẫn kiểm tra handler DOM nội bộ.
async function choose(frame,id){
  await frame.locator('#expression').evaluate((el,value)=>{
    if(![...el.options].some(option=>option.value===value))throw Error('Unsupported expression option');
    el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));
  },id);
}
async function internalClick(frame,id){await frame.locator(`#${id}`).evaluate(el=>el.click());}

test.use({demoRole: 'user'});
for (const width of [390, 768, 1024, 1440]) test(`Expressions ${width} @expressions`, async ({page}) => {
  await page.setViewportSize({width, height: 1080});
  const frame = await robotFrame(page);
  const identity = await preserveIdentity(frame);
  const selector = frame.locator('#expression');
  await expect(selector).toHaveValue('neutral');
  await expect(selector).toBeHidden();
  for (const dark of [false, true]) {
    await ensureSidebar(page);
    await setTheme(page, dark);
    await dismissOverlaySidebar(page);
    await frame.locator('#stage').scrollIntoViewIfNeeded();
    for (const id of ['happy', 'angry', 'sad', 'sleepy', 'neutral', 'sleepy', 'neutral']) {
      await choose(frame,id);
      await expect(selector).toHaveValue(id);
    }
    const bounds = await frame.locator('canvas').evaluate(el => {
      const r = el.getBoundingClientRect();
      return {left:r.left, right:r.right, bottom:r.bottom, width:innerWidth, height:innerHeight};
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    expect(Object.values(await compareIdentity(identity, frame)).every(Boolean)).toBe(true);
    expect(await frame.evaluate(() => window.__AIVA3D__.rendererInitializations)).toBe(1);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(frame.locator('#wave')).toBeDisabled();
  await choose(frame,'sleepy');
  await expect(frame.locator('#status')).toHaveText('Giảm chuyển động');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(frame.locator('#wave')).toBeEnabled();
  await internalClick(frame,'wave');
  await internalClick(frame,'reset');
  await frame.locator('canvas').press('ArrowLeft');
  await frame.locator('canvas').press('-');
  await internalClick(frame,'pause');
  await expect(frame.locator('#wave')).toBeDisabled();
  for (const id of ['neutral', 'happy', 'angry', 'sad', 'sleepy']) {
    await choose(frame,id);
    if (width === 1440) await frame.locator('#stage').screenshot({path:path.join(runDir, 'screenshots', `expression-${id}.png`)});
  }
  expect(Object.values(await compareIdentity(identity, frame)).every(Boolean)).toBe(true);
});

test.describe('Login expression preview', () => {
  test.use({demoRole:'guest'});
  for (const width of [390, 768, 1024, 1440]) test(`Hero expressions ${width} @expressions`, async ({page}) => {
    await page.setViewportSize({width, height:1080});
    const frame = await robotFrame(page);
    const identity = await preserveIdentity(frame);
    await internalClick(frame,'pause');
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      for (const id of ['neutral', 'happy', 'angry', 'sad', 'sleepy']) {
        const selector = frame.locator('#expression');
        await expect(selector).toBeHidden();
        await choose(frame,id);
        await frame.locator('canvas').focus();
        await expect(frame.locator('canvas')).toBeFocused();
        const layout = await frame.locator('canvas').evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0;
        });
        expect(layout).toBe(true);
        if (width === 1440) await frame.locator('#stage').screenshot({path:path.join(runDir,'screenshots',`hero-${dark?'dark':'light'}-${id}.png`)});
      }
      expect(Object.values(await compareIdentity(identity, frame)).every(Boolean)).toBe(true);
      expect(await frame.evaluate(() => window.__AIVA3D__.rendererInitializations)).toBe(1);
    }
  });
});
