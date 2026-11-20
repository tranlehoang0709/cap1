import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingChatTurn } from '../src/lib/chat-turn';

test('retry retains the same request ID and exact prepared memory context', () => {
    const a = pendingChatTurn(null, 'hello', '1', () => 'first');
    a.prepared = 'hello plus explicitly selected memories';
    const retry = pendingChatTurn(a, 'hello', '1', () => { throw Error('must not regenerate'); });
    assert.equal(retry, a);
    assert.equal(retry.prepared, a.prepared);
});
test('New Chat creates a new request even when the prompt is identical', () => {
    const a = pendingChatTurn(null, 'hello', '', () => 'first');
    const b = pendingChatTurn(null, 'hello', '', () => 'new-chat');
    assert.notEqual(a.id, b.id);
});
test('different input or selected conversation cannot reuse a prior request', () => {
    const a = pendingChatTurn(null, 'hello', '1', () => 'first');
    assert.equal(pendingChatTurn(a, 'changed', '1', () => 'changed').id, 'changed');
    assert.equal(pendingChatTurn(a, 'hello', '2', () => 'other-conversation').id, 'other-conversation');
});
test('successful completion clears pending state so identical subsequent input is a new turn', () => {
    const a = pendingChatTurn(null, 'hello', '1', () => 'first');
    const b = pendingChatTurn(null, 'hello', '1', () => 'next-turn');
    assert.notEqual(a.id, b.id);
});
