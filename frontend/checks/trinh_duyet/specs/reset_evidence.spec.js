import {test,expect} from '../fixtures/phien_demo.js';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {robotFrame} from '../helpers/robot.js';
import {rememberCanvasCapture,latestCanvasCapture,collectResetFailure} from '../helpers/reset_failure_evidence.js';

test.use({demoRole:'user'});
test('Original Reset equality fails on mismatched fixture; collector preserves original buffers @reset_evidence',async({page},testInfo)=>{
  const frame=await robotFrame(page);
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const expected=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAFUlEQVR4nGNkYGD4z4AFMGETJE8CAGGUAQfatSlXAAAAAElFTkSuQmCC','base64');
  const actual=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAG0lEQVR4nGNkYGD4z4AFMMEY//+jyjMS1IEOAFGABQKJeL7XAAAAAElFTkSuQmCC','base64');
  const original=sha(expected),actualHash=sha(actual);
  rememberCanvasCapture(frame,expected,original);
  const reference=latestCanvasCapture(frame);
  let attempts=0,evidence,failure;
  // Fixture cung cấp PNG cố ý sai; không tác động camera hoặc ảnh production.
  const settleReset=async()=>{attempts++;rememberCanvasCapture(frame,actual,actualHash);return actualHash;};
  try {
    await expect.poll(() => settleReset(frame)).toBe(original);
  } catch(error) {
    failure=error;const atFailure=attempts;
    evidence=await collectResetFailure({expected:reference,actual:latestCanvasCapture(frame),error,frame,
      imageSource:'INTENTIONAL 6x4 fixture, not the live robot canvas; observation is after failure'});
    expect(attempts).toBe(atFailure); // Collector không gọi lại polling/capture.
  }
  expect(failure).toBeTruthy();
  expect(failure.message).toContain(original);
  expect(failure.message).toContain(actualHash);
  expect(evidence.report.collectionErrors).toEqual([]);
  expect(evidence.report.inputsUnchanged).toBe(true);
  expect(sha(await fs.readFile(path.join(evidence.directory,'expected.png')))).toBe(original);
  expect(sha(await fs.readFile(path.join(evidence.directory,'actual.png')))).toBe(actualHash);
  const difference=JSON.parse(await fs.readFile(path.join(evidence.directory,'pixel-difference.json'),'utf8'));
  expect(difference.differentPixels).toBe(1);
  expect(difference.bbox).toEqual([2,1,3,2]);
  await expect(frame.locator('#reset')).toBeHidden();
  await testInfo.attach('fixture-original-failure.json',{body:JSON.stringify({originalAssertionFailed:true,originalFailure:failure.message,expectedHash:original,actualHash,attempts,collectorRetries:0,directory:evidence.directory}),contentType:'application/json'});
});
