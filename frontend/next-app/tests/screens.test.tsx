import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace } from '../src/components/workspace';
import {
  cols,
  requiresStrictConfirmation,
  StructuredDataView,
} from '../src/components/data-ui';

test('User screens render honest pending/empty states without personal key or provider controls', () => {
  for (const section of [
    'dashboard',
    'chat',
    'robots',
    'assistant',
    'conversations',
    'privacy',
  ]) {
    const html = renderToStaticMarkup(<Workspace section={section} admin={false} />);
    assert.ok(html.length > 100);
    assert.ok(!html.includes('name="provider_id"'));
    assert.ok(!html.includes('name="secret"'));
    assert.ok(!html.includes('operation="unlink"'));
  }
});

test('Admin screens render without needing fabricated Backend records', () => {
  for (const section of [
    'dashboard',
    'users',
    'robots',
    'ai',
    'keys',
    'quotas',
    'firmware',
    'monitoring',
    'settings',
  ]) {
    const html = renderToStaticMarkup(<Workspace section={section} admin />);
    assert.ok(html.includes('Đang tải'));
    assert.ok(!html.includes('test@example'));
  }
});

test('Unified NOVA identity replaces legacy purple robot-face and Admin Dashboard prioritizes operational summary', () => {
  const userDash = renderToStaticMarkup(<Workspace section="dashboard" admin={false} />);
  assert.ok(userDash.includes('user-dashboard'), 'Workspace user dashboard renders UserDashboard');
  assert.ok(userDash.includes('nova-emblem'), 'Uses unified NOVA emblem');
  assert.ok(!userDash.includes('robot-face'), 'Legacy purple robot-face removed');

  const adminDash = renderToStaticMarkup(<Workspace section="dashboard" admin />);
  assert.ok(adminDash.includes('Trạng thái vận hành &amp; Điều hướng'));
  assert.ok(!adminDash.includes('robot-face'));
});

test('Confirmation policy only requires checkbox for dangerous or security-critical actions', () => {
  assert.equal(
    requiresStrictConfirmation({ title: 'Đổi tên robot', operation: 'robotRename' }),
    false
  );
  assert.equal(
    requiresStrictConfirmation({ title: 'Cập nhật tài khoản', operation: 'profileSave' }),
    false
  );
  assert.equal(
    requiresStrictConfirmation({ title: 'Cấu hình trợ lý', operation: 'assistantSave' }),
    false
  );
  assert.equal(
    requiresStrictConfirmation({ title: 'Ghép nối robot', operation: 'pair' }),
    false
  );
  assert.equal(
    requiresStrictConfirmation({
      title: 'Thu hồi và yêu cầu reset',
      operation: 'revoke',
      danger: true,
    }),
    true
  );
  assert.equal(
    requiresStrictConfirmation({ title: 'Đổi mật khẩu', operation: 'password' }),
    true
  );
  assert.equal(
    requiresStrictConfirmation({
      title: 'Xóa hội thoại',
      operation: 'conversationDelete',
      danger: true,
    }),
    true
  );
});

test('Column labels translate all technical snake_case/camelCase keys into Vietnamese', () => {
  const keys = [
    'instance_code',
    'last_healthcheck_at',
    'requests',
    'input_tokens',
    'output_tokens',
    'tokens',
    'device_id',
    'backupId',
    'operationId',
    'createdAt',
    'expiresAt',
    'restoredAt',
    'email_verified_at',
    'released_at',
    'actor_user_id',
    'target_id',
    'setting_key',
    'setting_value',
    'updated_at',
  ];
  const translated = cols(...keys);
  for (const col of translated) {
    assert.notEqual(col.label, col.key, `Expected ${col.key} to have a Vietnamese label`);
    assert.ok(!col.label.includes('_'), `Expected ${col.label} not to contain underscores`);
  }
});

test('StructuredDataView renders structured definition lists and tables instead of raw JSON by default', () => {
  const html = renderToStaticMarkup(
    <StructuredDataView
      data={{ status: 'RESET_PENDING', operationId: '42', requestedAt: '2026-11-12T10:00:00Z' }}
    />
  );
  assert.ok(html.includes('<dl class="details">'));
  assert.ok(html.includes('Mã tiến trình'));
  assert.ok(html.includes('RESET_PENDING'));
  assert.ok(!html.includes('<pre'));
});
