import test from 'node:test';
import assert from 'node:assert/strict';
import { createNova } from '../src/components/robot/engine/model.js';
import { BeastController } from '../src/components/robot/engine/beast.js';
import { NovaInteractionController } from '../src/components/robot/NovaInteractionController';
import { filterSystemSettings, sanitizeResponse } from '../src/lib/validation';
import { resolveOperation } from '../src/lib/operations';

test('embedded stage delegates idle activation to the UI controller and never starts a disabled Beast mode', () => {
  const nova = createNova();
  const beast = new BeastController(nova);
  beast.autoIdle = false;
  for (let i = 0; i < 400; i++) beast.update({}, .02, { canIdle: true });
  assert.equal(beast.progress, 0);
  beast.setActive(true);
  for (let i = 0; i < 60; i++) beast.update({}, .02, { canIdle: true });
  assert.equal(beast.progress, 1);
  beast.interrupt();
  for (let i = 0; i < 400; i++) beast.update({}, .02, { canIdle: true });
  assert.equal(beast.progress, 0);
  nova.dispose();
});

test('generic interaction restarts the complete idle delay, companion preview controls remain interruptible', () => {
  const c = new NovaInteractionController();
  for (let i = 0; i < 240; i++) c.tick(.02);
  c.send({ type: 'interact' });
  for (let i = 0; i < 240; i++) c.tick(.02);
  assert.equal(c.getSnapshot().beast, false);
  for (let i = 0; i < 20; i++) c.tick(.02);
  assert.equal(c.getSnapshot().beast, true);
  c.send({ type: 'preview', mode: 'thinking' });
  assert.equal(c.getSnapshot().mode, 'thinking');
  c.send({ type: 'preview', mode: 'greeting' });
  assert.equal(c.getSnapshot().action, 'wave');
  c.send({ type: 'preview', mode: 'idle' });
  assert.equal(c.getSnapshot().mode, 'idle');
});

test('settings protection shares read/write rules without blocking legitimate non-secret keys or rewriting pagination totals', () => {
  const allowed = ['platform.default_locale', 'usage.tokens_per_month', 'platform.tokenizer', 'platform.credentialless'];
  for (const key of allowed) assert.ok(resolveOperation('settingSave', 'ADMIN', { key }));
  for (const key of ['recovery.reset.1.challenge', 'auth.accessToken', 'device.private_key', 'auth.password_hash']) {
    assert.throws(() => resolveOperation('settingSave', 'ADMIN', { key }), /FORBIDDEN_SETTING_KEY/);
  }
  const page = { items: [{ setting_key: allowed[0] }, { setting_key: 'recovery.reset.1.challenge' }], total: 80 };
  assert.deepEqual(filterSystemSettings(page), { items: [{ setting_key: allowed[0] }], total: 80 });
});

test('recursive sanitizer strips snake/camel credentials and hashes while retaining authorized public metadata', () => {
  assert.deepEqual(sanitizeResponse({ accessToken: 'hidden', hash: 'hidden', token: 'hidden', nested: [{ credentials: 'hidden', challengeHash: 'hidden', refresh_token: 'hidden' }], pairing_code: 'one-time', secret_hint: '****1234', checksum_sha256: 'abc', input_tokens: 1, output_tokens: 2, total_tokens: 3, tokens_per_month: '9007199254740993' }), { nested: [{}], pairing_code: 'one-time', secret_hint: '****1234', checksum_sha256: 'abc', input_tokens: 1, output_tokens: 2, total_tokens: 3, tokens_per_month: '9007199254740993' });
});
