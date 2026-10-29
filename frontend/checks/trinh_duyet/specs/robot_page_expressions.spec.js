import {test, expect} from '../fixtures/phien_demo.js';
import {robotFrame, canvasHash} from '../helpers/robot.js';
import {runDir} from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {navigate, ensureSidebar, dismissOverlaySidebar} from '../helpers/dieu_huong.js';
import {setTheme} from '../helpers/chu_de.js';
import {preserveIdentity, compareIdentity} from '../helpers/vong_doi_iframe.js';

test.use({demoRole:'user'});
for(const width of [390,768,1024,1440]) test(`Robot page expression isolation ${width} @robot_page_expressions`,async({page})=>{
  await page.setViewportSize({width,height:1080});
  const dashboard=await robotFrame(page);
  await expect(dashboard.locator('#expression')).toBeHidden();
  await navigate(page,'Thiết bị của tôi');
  await expect.poll(async()=>{
    let count=0;
    for(const f of page.frames()) if(await f.locator('#stage').count().catch(()=>0)) count++;
    return count;
  }).toBe(3);
  const frames=[];
  for(const f of page.frames()) if(await f.locator('#stage').count().catch(()=>0)) frames.push(f);
  const online=[],offline=[];
  for(const f of frames) {
    const flag=await f.evaluate(()=>JSON.parse(document.getElementById('aiva-config').textContent).online);
    (flag?online:offline).push(f);
  }
  expect(online).toHaveLength(2);
  expect(offline).toHaveLength(1);
  for(const dark of [false,true]) {
    await ensureSidebar(page);await setTheme(page,dark);await dismissOverlaySidebar(page);
    for(const f of frames) {
      await f.locator('#stage').scrollIntoViewIfNeeded();
      await expect(f.locator('#expression')).toBeVisible();
      expect(await f.locator('#expression').evaluate(el=>{
        const r=el.getBoundingClientRect();
        return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
      })).toBe(true);
      await expect(f.locator('.expression-demo')).toContainText('Demo frontend');
      for(const id of ['wave','reset','pause']) await expect(f.locator(`#${id}`)).toBeHidden();
    }
    await expect(offline[0].locator('#expression')).toBeDisabled();
    for(const f of online) {await f.locator('#stage').scrollIntoViewIfNeeded();await f.locator('#expression').selectOption('neutral');}
    await online[0].locator('#stage').scrollIntoViewIfNeeded();
    const identity=await preserveIdentity(online[0]);
    expect(await online[0].locator('#expression option').evaluateAll(options=>options.map(o=>o.value))).toEqual(['neutral','happy','angry','sad','sleepy']);
    for(const id of ['happy','angry','sad','sleepy','neutral']) {
      await online[0].locator('#expression').selectOption(id);
      await expect(online[0].locator('#expression')).toHaveValue(id);
      await expect(online[1].locator('#expression')).toHaveValue('neutral');
      await expect(offline[0].locator('#expression')).toHaveValue('neutral');
    }
    expect(Object.values(await compareIdentity(identity,online[0])).every(Boolean)).toBe(true);
    await identity.dispose();
    if(width===1440){
      for(const f of online) await f.evaluate(()=>{const b=document.getElementById('pause');if(b.getAttribute('aria-pressed')==='false')b.click();});
      const before=[await canvasHash(online[0]),await canvasHash(online[1])];
      await online[0].locator('#expression').selectOption('happy');
      const after=[await canvasHash(online[0]),await canvasHash(online[1])];
      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      for(let i=0;i<online.length;i++){
        await online[i].locator('#stage').screenshot({path:path.join(runDir,'screenshots',`online-${i+1}-${dark?'dark':'light'}.png`)});
      }
      for(const id of ['neutral','happy','angry','sad','sleepy']){
        await online[0].locator('#expression').selectOption(id);
        await online[0].locator('#stage').screenshot({path:path.join(runDir,'screenshots',`pixel-${id}-${dark?'dark':'light'}.png`)});
      }
      await fs.mkdir(path.join(runDir,'analysis'),{recursive:true});
      await fs.writeFile(path.join(runDir,'analysis',`isolation-${dark?'dark':'light'}.json`),JSON.stringify({url:page.url(),width,before,after,unchangedSecond:after[1]===before[1]},null,2));
    }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
