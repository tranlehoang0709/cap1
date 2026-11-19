import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/auth/[action]/route';
import { request, ApiError } from '../src/lib/client';

// Run: node --conditions=react-server --import tsx --test tests/auth-otp.bff.ts
// Synthetic transport fixtures only; these tests never reach SMTP or real users.
const origin = 'http://127.0.0.1:3100';
function verifyRequest(body: unknown) {
  return new Request(`${origin}/api/auth/verify`, { method: 'POST',
    headers: { origin, host: '127.0.0.1:3100', 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ action: 'verify' }) };

test('BFF forwards the six-digit string including its leading zero to the verification endpoint', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    calls++;
    assert.equal(url.pathname, '/auth/verify-email');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(String(options.body)), { email: 'Person@example.test', code: '012345' });
    return Response.json({ success: true });
  });
  const response = await POST(verifyRequest({ email: 'Person@example.test', code: ' 012345 ' }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls, 1);
});

test('BFF rejects malformed OTP before contacting Backend', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected upstream'); });
  const response = await POST(verifyRequest({ email: 'person@example.test', code: '12345' }), context);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

for (const [status, code] of [[400, 'OTP_INVALID'], [400, 'OTP_EXPIRED'], [400, 'OTP_TOO_MANY_ATTEMPTS'],
  [401, 'EMAIL_NOT_VERIFIED'], [401, 'ACCOUNT_SUSPENDED'], [401, 'ACCOUNT_DISABLED'],
  [401, 'INVALID_CREDENTIALS'], [400, 'BAD_REQUEST'], [500, 'INTERNAL_SERVER_ERROR']] as const) {
  test(`client → BFF → Backend preserves ${code} without reporting success`, async t => {
    const safeMessage = status === 500 ? 'Internal server error' : 'Mã OTP không hợp lệ hoặc đã hết hạn.';
    t.mock.method(globalThis, 'fetch', async (url: string | URL, options: RequestInit) => {
      if (String(url) === '/api/auth/verify') {
        return POST(verifyRequest(JSON.parse(String(options.body))), context);
      }
      assert.equal(new URL(url).pathname, '/auth/verify-email');
      return Response.json({ code, message: safeMessage }, { status });
    });
    await assert.rejects(request('/api/auth/verify', { email: 'person@example.test', code: '012345' }),
      (error: unknown) => error instanceof ApiError && error.status === status && error.code === code && error.message === safeMessage);
  });
}

test('BFF rejects a cross-site verification request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected upstream'); });
  const req = verifyRequest({ email: 'person@example.test', code: '012345' });
  req.headers.set('origin', 'https://untrusted.invalid');
  assert.equal((await POST(req, context)).status, 403);
  assert.equal(calls, 0);
});
