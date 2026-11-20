import test from 'node:test';
import assert from 'node:assert/strict';
import { operations, resolveOperation } from '../src/lib/operations';
import { chatReply, rows } from '../src/lib/contracts';
import { sanitizeResponse, validateBody, assertAcknowledged, filterSystemSettings } from '../src/lib/validation';
test('mutation cannot be reported as successful without Backend acknowledgement',()=>{for(const value of [null,undefined,{success:false},{allowed:false}])assert.throws(()=>assertAcknowledged(value));assert.doesNotThrow(()=>assertAcknowledged({success:true}));assert.doesNotThrow(()=>assertAcknowledged({status:'RESET_PENDING',operationId:'1'}));});
import { sameOrigin } from '../src/lib/origin';
import { providerForChat, requireSystemScope } from '../src/lib/chat-policy';
test('chat fails closed for personal keys and disabled or unconfigured providers', () => { assert.throws(() => providerForChat([], undefined), /BLOCKED/); assert.throws(() => providerForChat([{ id: '1', is_enabled: false }], '1'), /BLOCKED/); const provider = providerForChat([{ id: '1', code: 'GEMINI', is_enabled: true }], '1'); assert.throws(() => requireSystemScope(provider, { credentialScope: 'USER' }), /Personal API Key/); assert.doesNotThrow(() => requireSystemScope(provider, { credentialScope: 'SYSTEM' })); assert.doesNotThrow(() => requireSystemScope({ code: 'LOCAL' }, {})); });
test('origin guard supports Next internal localhost rewriting without accepting cross-site requests', () => { assert.equal(sameOrigin('http://localhost:3100/api/backend', '127.0.0.1:3100', 'http://127.0.0.1:3100'), true); assert.equal(sameOrigin('http://localhost:3100/api/backend', '127.0.0.1:3100', 'https://evil.invalid'), false); assert.equal(sameOrigin('http://localhost:3100/api/backend', '127.0.0.1:3100', null), false); assert.equal(sameOrigin('http://localhost:3100/api/backend', 'internal:3100', 'https://aiva.example.com', 'https://aiva.example.com'), true); });
test('User cannot invoke admin, personal keys, provider selection, or unlink', () => { for (const [name, op] of Object.entries(operations)) {
    if (op.role === 'ADMIN')
        assert.throws(() => resolveOperation(name, 'USER', { id: '1', key: 'safe' }), /FORBIDDEN/);
} for (const name of ['unlink', 'personalKeys', 'providerChoose', 'internalResetAck'])
    assert.throws(() => resolveOperation(name, 'USER'), /UNKNOWN_OPERATION/); assert.deepEqual(operations.chat.fields, ['content', 'conversation_id', 'request_id']); assert.ok(!operations.assistantSave.fields?.includes('preferred_provider_id')); assert.equal(resolveOperation('userAiDataDelete', 'USER').path, '/users/me/ai-data'); assert.equal(resolveOperation('conversationClose', 'USER', { id: '5' }).path, '/conversations/5/close'); assert.equal(resolveOperation('conversationResume', 'USER', { id: '5' }).path, '/conversations/5/resume'); assert.equal(resolveOperation('instanceMetrics', 'ADMIN', { id: '2' }).path, '/admin/monitoring/instances/2/metrics'); });
test('path parameters reject traversal, encoded URLs and invalid identifiers', () => { for (const id of ['../users', 'https://example.org', '1/approve', '%2F', '0', '1?x=1'])
    assert.throws(() => resolveOperation('robotRename', 'USER', { id }), /INVALID_PARAMETER/); assert.equal(resolveOperation('robotRename', 'USER', { id: '9223372036854775807' }).path, '/devices/9223372036854775807'); });
test('chat accepts both persisted chat and grounded PA-08 responses', () => { assert.ok(chatReply.safeParse({ content: 'answer', conversation_id: '1', usage: { input_tokens: 1, output_tokens: 2 } }).success); assert.ok(chatReply.safeParse({ content: 'Không có lịch.', tool: 'schedule.query', grounded: true }).success); assert.equal(chatReply.safeParse({ id: '1', user_id: '2', messages: [] }).success, false); });
test('tokens and secrets are recursively removed, hints and one-time pairing codes retained', () => { assert.deepEqual(sanitizeResponse({ verification_token: 'private', challenge: 'private', code_hash: 'private', pairing_code: 'one-time-code-123', checksum_sha256: 'abc', input_tokens: 10, id: '1', items: [{ secret: 'private', secret_hint: '****1234', access_token: 'private', token_hash: 'private' }] }), { pairing_code: 'one-time-code-123', checksum_sha256: 'abc', input_tokens: 10, id: '1', items: [{ secret_hint: '****1234' }] }); });
test('internal recovery and secret setting keys are blocked on write and filtered on read', () => {
    for (const forbiddenKey of ['recovery.reset.12.challenge', 'recovery.revoke.1.hash', 'jwt_secret', 'device_reset_service_token', 'api_key_default']) {
        assert.throws(() => resolveOperation('settingSave', 'ADMIN', { key: forbiddenKey }), /FORBIDDEN_SETTING_KEY/);
    }
    assert.equal(resolveOperation('settingSave', 'ADMIN', { key: 'platform.default_locale' }).path, '/admin/system-settings/platform.default_locale');
    const filtered = filterSystemSettings([
        { setting_key: 'platform.default_locale', setting_value: '"vi"' },
        { setting_key: 'recovery.reset.12.challenge', setting_value: '{"hash":"abc","attempt":1}' },
        { setting_key: 'recovery.revoke.1.deadbeef', setting_value: '{"operationId":"5"}' },
    ]);
    assert.deepEqual(filtered, [{ setting_key: 'platform.default_locale', setting_value: '"vi"' }]);
});
test('quota preserves BIGINT strings and rejects invalid limits', () => { assert.doesNotThrow(() => validateBody('quotaSave', { tokens_per_month: '9223372036854775807' })); assert.throws(() => validateBody('quotaSave', { tokens_per_month: 9007199254740992 })); assert.throws(() => validateBody('quotaSave', { requests_per_minute: -1 })); });
test('malformed API lists fail instead of showing empty KPI', () => { assert.throws(() => rows({ wrong: [] })); assert.deepEqual(rows({ items: [], total: 0 }), []); });
