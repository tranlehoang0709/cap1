import {test,expect} from '../fixtures/phien_demo.js';
import {robotFrame,pauseRobot,resetRobot,settleReset,neutralCanvasFocus,canvasHash} from '../helpers/robot.js';
import {preserveIdentity,compareIdentity,inspectRobot} from '../helpers/vong_doi_iframe.js';

test.use({demoRole:'user'});
test('Hidden Reset uses original handler; focus normalization preserves paused view @reset_interaction',async({page},testInfo)=>{
  const frame=await robotFrame(page);
  const identity=await preserveIdentity(frame);
  const initial=await inspectRobot(frame);
  for(const id of ['reset','pause','wave','expression'])await expect(frame.locator(`#${id}`)).toBeHidden();
  await pauseRobot(frame);
  await expect(frame.locator('#pause')).toHaveAttribute('aria-pressed','true');
  const original=await settleReset(frame);
  await frame.locator('canvas').press('ArrowLeft');
  await frame.locator('canvas').press('-');
  await neutralCanvasFocus(frame);
  const changed=await canvasHash(frame);
  expect(changed).not.toBe(original);
  // Blur chỉ chuẩn hóa focus: không được reset hoặc đổi ảnh camera đã xoay.
  await frame.locator('canvas').focus();
  await neutralCanvasFocus(frame);
  expect(await canvasHash(frame)).toBe(changed);
  // R là đường Reset người dùng hiện có, độc lập với click nút ẩn.
  await frame.locator('canvas').press('r');
  await neutralCanvasFocus(frame);
  const keyboardReset=await canvasHash(frame);
  expect(keyboardReset).toBe(original);
  await frame.locator('canvas').press('ArrowRight');
  await neutralCanvasFocus(frame);
  expect(await canvasHash(frame)).not.toBe(original);
  await resetRobot(frame);
  await neutralCanvasFocus(frame);
  expect(await canvasHash(frame)).toBe(keyboardReset);
  expect(await settleReset(frame)).toBe(original);
  expect(Object.values(await compareIdentity(identity,frame)).every(Boolean)).toBe(true);
  expect(await frame.evaluate(()=>window.__AIVA3D__.rendererInitializations)).toBe(initial.diagnostics.rendererInitializations);
  await expect(frame.locator('#reset')).toBeHidden();
  await testInfo.attach('reset-equivalence.json',{body:JSON.stringify({original,changed,keyboardReset,identity:await compareIdentity(identity,frame),focus:await frame.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}))}),contentType:'application/json'});
  await identity.dispose();
});
