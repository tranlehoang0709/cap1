import test from 'node:test';
import assert from 'node:assert/strict';
import {cssTimeMilliseconds} from '../src/components/motion/useAuthPanelMotion';
test('CSS motion tokens retain their duration after production unit minification',()=>{
 assert.equal(cssTimeMilliseconds('200ms'),200);
 assert.equal(cssTimeMilliseconds('.2s'),200);
 assert.equal(cssTimeMilliseconds(' 0.16s '),160);
 assert.equal(cssTimeMilliseconds('0ms'),0);
 assert.equal(cssTimeMilliseconds(''),200);
});
