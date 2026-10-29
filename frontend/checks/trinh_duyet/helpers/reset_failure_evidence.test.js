import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rememberCanvasCapture,latestCanvasCapture,collectResetFailure} from './reset_failure_evidence.js';

export const expectedPNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAFUlEQVR4nGNkYGD4z4AFMGETJE8CAGGUAQfatSlXAAAAAElFTkSuQmCC','base64');
export const actualPNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAG0lEQVR4nGNkYGD4z4AFMMEY//+jyjMS1IEOAFGABQKJeL7XAAAAAElFTkSuQmCC','base64');
const sha=b=>createHash('sha256').update(b).digest('hex');

test('cache retains the exact assertion buffers without calling screenshot',()=>{
  const frame={locator(){throw Error('No screenshot allowed');}};
  rememberCanvasCapture(frame,expectedPNG,sha(expectedPNG));
  const reference=latestCanvasCapture(frame);
  rememberCanvasCapture(frame,actualPNG,sha(actualPNG));
  assert.equal(reference.png,expectedPNG);
  assert.equal(latestCanvasCapture(frame).png,actualPNG);
  assert.notEqual(reference.sha256,latestCanvasCapture(frame).sha256);
});

test('failure collector preserves immutable PNGs and measures exact fixture difference',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aiva-reset-evidence-'));
  const expected={png:expectedPNG,sha256:sha(expectedPNG)},actual={png:actualPNG,sha256:sha(actualPNG)};
  const result=await collectResetFailure({expected,actual,root,error:new Error('intentional mismatch'),
    observeState:async()=>({fixture:true}),collectProvenance:async()=>({fixture:true})});
  assert.equal(result.report.collectionErrors.length,0);
  assert.ok((await fs.readFile(path.join(result.directory,'expected.png'))).equals(expectedPNG));
  assert.ok((await fs.readFile(path.join(result.directory,'actual.png'))).equals(actualPNG));
  assert.equal(sha(expectedPNG),expected.sha256);assert.equal(sha(actualPNG),actual.sha256);
  const difference=JSON.parse(await fs.readFile(path.join(result.directory,'pixel-difference.json'),'utf8'));
  assert.equal(difference.differentPixels,1);
  assert.deepEqual(difference.bbox,[2,1,3,2]);
  assert.equal(result.report.inputsUnchanged,true);
});
