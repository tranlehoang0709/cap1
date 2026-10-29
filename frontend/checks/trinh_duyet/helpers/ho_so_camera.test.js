/** Kiểm tra registry không fallback và không làm mất trạng thái INCONCLUSIVE. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedCameraProfile, cameraModelReference, legacyModel, renderer, assertCameraFingerprint, sameEvidence, chrome156Environment, chrome156MainEnvironment, assertMainServerEvidence, assertEnvironment156, assertCameraValidationReceipt, cameraChecksums } from './ho_so_camera.js';
import { evaluateCameraMetrics } from './robot.js';

const modern = 'chrome-155.0.8059.86', old = 'chrome-155.0.8059.41';
const fingerprint = { browserVersion: '155.0.8059.86', channel: 'chrome', os: 'win32',
  gpuVendor: 'Google Inc. (Intel)', renderer, backend: 'D3D11',
  webglVersion: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)', viewport: { width: 1440, height: 1080 },
  dpr: 1, threeRevision: '180', hero: false, canvasCSS: { width: 305, height: 142 },
  drawingBuffer: { width: 305, height: 142 } };

test('phải chọn profile tường minh, không nhận profile không có trong registry', () => {
  for (const env of [{}, { AIVA_CAMERA_PROFILE: 'chrome' }]) assert.throws(() => selectedCameraProfile(env), /INCONCLUSIVE/);
  assert.equal(selectedCameraProfile({ AIVA_CAMERA_PROFILE: modern }).version, '155.0.8059.86');
});

test('model .41 và SHA gốc bất biến, không thay thế giữa hai profile', () => {
  assert.equal(cameraModelReference({ AIVA_CAMERA_PROFILE: old }), legacyModel);
  assert.equal(legacyModel.sha256, 'e55ed65af650bf84771fff821b5aa5970690bc710bf60c98b4799137eecf39b7');
  assert.throws(() => cameraModelReference({ AIVA_CAMERA_PROFILE: old, AIVA_CAMERA_MODEL_SHA256: '0'.repeat(64) }), /INCONCLUSIVE/);
  assert.throws(() => cameraModelReference({ AIVA_CAMERA_PROFILE: modern, AIVA_CAMERA_MODEL: legacyModel.path, AIVA_CAMERA_MODEL_SHA256: legacyModel.sha256 }), /INCONCLUSIVE/);
});

test('profile .86 cần model path và digest tường minh', () => {
  assert.throws(() => cameraModelReference({ AIVA_CAMERA_PROFILE: modern }), /INCONCLUSIVE/);
  const reference = cameraModelReference({ AIVA_CAMERA_PROFILE: modern, AIVA_CAMERA_MODEL: 'E:/candidate/model.json', AIVA_CAMERA_MODEL_SHA256: 'a'.repeat(64) });
  assert.equal(reference.sha256, 'a'.repeat(64));
});

test('gate .86 từ chối browser/GPU/backend/OS/canvas/DPR/Three.js khác', () => {
  const profile = selectedCameraProfile({ AIVA_CAMERA_PROFILE: modern });
  assert.doesNotThrow(() => assertCameraFingerprint(profile, fingerprint));
  for (const [key, value] of Object.entries({ browserVersion: '155.0.8059.41', channel: 'chromium', os: 'linux', gpuVendor: 'other', renderer: 'SwiftShader', backend: 'Vulkan', dpr: 2, threeRevision: '186', hero: true, viewport: { width: 1441, height: 1080 }, canvasCSS: { width: 306, height: 142 }, drawingBuffer: { width: 610, height: 284 } })) {
    assert.throws(() => assertCameraFingerprint(profile, { ...fingerprint, [key]: value }), /INCONCLUSIVE/, key);
  }
});

test('không suy diễn metadata lịch sử .41; checksum comparison không phụ thuộc thứ tự key', () => {
  assert.doesNotThrow(() => assertCameraFingerprint(selectedCameraProfile({ AIVA_CAMERA_PROFILE: old }),
    { browserVersion: '155.0.8059.41', channel: 'chrome', renderer, viewport: { width: 1440, height: 1080 }, dpr: 1 }));
  assert.equal(sameEvidence({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameEvidence({ hash: 'a' }, { hash: 'b' }), false);
});

test('classifier giữ nguyên vùng INCONCLUSIVE và không chấp nhận quality sai', () => {
  const model = { themes: { dark: { status: 'SEPARATED', passThreshold: 0.2, changeThreshold: 0.3 } } };
  const pair = { name: 'control', theme: 'dark', kind: 'positive', quality: 'VALID', geometryScore: 0.1 };
  const evaluate = delta => evaluateCameraMetrics({ pairs: [{ ...pair, ...delta }] }, model)[0];
  assert.equal(evaluate({}).status, 'PASS');
  assert.equal(evaluate({ geometryScore: 0.25 }).status, 'INCONCLUSIVE');
  assert.equal(evaluate({ geometryScore: 0.4 }).status, 'FAIL');
  assert.equal(evaluate({ quality: 'INCONCLUSIVE' }).status, 'INCONCLUSIVE');
  assert.equal(evaluate({ kind: 'negative-drag2px', geometryScore: 0.4 }).status, 'PASS');
});

const isolatedId = 'chrome-156.0.8078.48';
const isolatedEnvironment = { ...chrome156Environment };
test('156 tường minh, môi trường riêng; browser/GPU/canvas sai vẫn bị từ chối', () => {
  const profile = selectedCameraProfile({ AIVA_CAMERA_PROFILE: isolatedId });
  const observed = { ...fingerprint, browserVersion: profile.version, environment: isolatedEnvironment };
  assert.equal(profile.isolated, true);
  assert.doesNotThrow(() => assertCameraFingerprint(profile, observed));
  for (const delta of [{ browserVersion: '156.0.8078.49' }, { renderer: 'SwiftShader' }, { environment: {} },
    { canvasCSS: { width: 306, height: 142 } }, { dpr: 2 }]) {
    assert.throws(() => assertCameraFingerprint(profile, { ...observed, ...delta }), /INCONCLUSIVE/);
  }
  assert.throws(() => selectedCameraProfile({ AIVA_CAMERA_PROFILE: 'chrome-156' }), /INCONCLUSIVE/);
  assert.throws(() => cameraModelReference({ AIVA_CAMERA_PROFILE: isolatedId }), /INCONCLUSIVE/);
  assert.throws(() => cameraModelReference({ AIVA_CAMERA_PROFILE: isolatedId, AIVA_CAMERA_MODEL: legacyModel.path, AIVA_CAMERA_MODEL_SHA256: legacyModel.sha256 }), /INCONCLUSIVE/);
  const main = selectedCameraProfile({ AIVA_CAMERA_PROFILE: 'chrome-156.0.8078.48-main' });
  assert.equal(main.main, true);
  const mainEnvironment = { ...chrome156MainEnvironment, prefix: 'E:/captone/frontend/.venv', server: { streamlit: '1.66.0' } };
  assert.doesNotThrow(() => assertCameraFingerprint(main, { ...observed, environment: mainEnvironment }));
  assert.throws(() => assertCameraFingerprint(main, observed), /INCONCLUSIVE/);
  assert.throws(() => assertCameraFingerprint(profile, { ...observed, environment: mainEnvironment }), /INCONCLUSIVE/);
});

test('156 từ chối sai executable, origin, framework hoặc manifest dependency', () => {
  assert.doesNotThrow(() => assertEnvironment156(isolatedEnvironment));
  for (const delta of [{ executableSHA256: '0'.repeat(64) }, { origin: 'http://localhost:8501' },
    { streamlit: '1.65.0' }, { dependencySHA256: '0'.repeat(64) }]) {
    assert.throws(() => assertEnvironment156({ ...isolatedEnvironment, ...delta }), /INCONCLUSIVE/);
  }
  const evidence = { pid: 123, executable: chrome156MainEnvironment.python, prefix: 'E:/captone/frontend/.venv',
    streamlit: '1.66.0', streamlitFile: 'E:/captone/frontend/.venv/Lib/site-packages/streamlit/__init__.py',
    baseExecutable: 'C:/Python/python.exe', launchScript: 'E:/artifacts/main-server.py',
    config: { 'server.port': 8501, 'server.enableCORS': true, 'server.enableXsrfProtection': true, 'server.headless': true, 'theme.base': 'dark' } };
  const actual = { pid: 123, owners: [123], executable: evidence.baseExecutable, commandLine: 'python E:/artifacts/main-server.py' };
  assert.doesNotThrow(() => assertMainServerEvidence(evidence, actual));
  for (const delta of [{ pid: 124 }, { owners: [124] }, { owners: [] }, { commandLine: 'python unrelated.py' }, { executable: 'C:/Other/python.exe' }]) {
    assert.throws(() => assertMainServerEvidence(evidence, { ...actual, ...delta }), /INCONCLUSIVE/);
  }
  assert.throws(() => assertMainServerEvidence({ ...evidence, streamlit: '1.65.0' }, actual), /INCONCLUSIVE/);
  assert.throws(() => assertMainServerEvidence({ ...evidence, config: { ...evidence.config, 'server.enableXsrfProtection': false } }, actual), /INCONCLUSIVE/);
});

function receiptFixture() {
  const checksums = { runtime: { bundle: 'fixed' }, tests: { collector: 'fixed' } };
  const model = { profileId: isolatedId, checksums };
  const cases = Array.from({ length: 8 }, (_, i) => ({
    caseId: `metric-validation-${String(i).padStart(2, '0')}`, split: 'validation',
    view: i % 2 ? 'right-3-zoomout-2' : 'left-3-zoomout-2', rawSHA256: 'a'.repeat(64), evaluationSHA256: 'b'.repeat(64),
    results: ['dark', 'light'].flatMap(theme => ['positive', 'focus-normalized', 'theme', 'negative-rotation', 'negative-zoom', 'negative-drag2px', 'reset', ...(theme === 'dark' ? ['default-restoration'] : [])]
      .map(kind => ({ theme, kind, status: 'PASS' }))),
  }));
  return { model, receipt: { status: 'VALIDATED_PENDING_USER_ACCEPTANCE', approved: false, profileId: isolatedId,
    modelSHA256: 'c'.repeat(64), checksums, cases } };
}

test('156 receipt gắn model bất biến, tám validation case độc lập và đủ negative controls', () => {
  const { model, receipt } = receiptFixture();
  assert.doesNotThrow(() => assertCameraValidationReceipt(receipt, model, 'c'.repeat(64)));
  const mainReceipt = structuredClone(receipt), mainModel = structuredClone(model);
  mainReceipt.profileId = mainModel.profileId = 'chrome-156.0.8078.48-main';
  assert.doesNotThrow(() => assertCameraValidationReceipt(mainReceipt, mainModel, 'c'.repeat(64)));
  assert.throws(() => assertCameraValidationReceipt(mainReceipt, model, 'c'.repeat(64)), /INCONCLUSIVE/);
  for (const change of [r => { r.status = 'APPROVED'; }, r => { r.approved = true; },
    r => { r.modelSHA256 = 'd'.repeat(64); }, r => { r.checksums.tests.collector = 'changed'; },
    r => { r.cases.pop(); }, r => { r.cases[1].caseId = r.cases[0].caseId; },
    r => { r.cases[0].split = 'train'; }, r => { r.cases[0].view = 'unknown'; },
    r => { r.cases[0].results[3].status = 'INCONCLUSIVE'; },
    r => { r.cases[0].results[3].kind = 'positive'; }]) {
    const copy = structuredClone(receipt); change(copy);
    assert.throws(() => assertCameraValidationReceipt(copy, model, 'c'.repeat(64)), /INCONCLUSIVE/);
  }
});

test('provenance xác định, chứa policy/collector nhưng không chứa model hoặc receipt tự tham chiếu', async () => {
  const first = await cameraChecksums(), second = await cameraChecksums();
  assert.equal(sameEvidence(first, second), true);
  assert.ok(first.tests['checks/trinh_duyet/helpers/moi_truong.js']);
  assert.ok(first.tests['checks/trinh_duyet/specs/robot.spec.js']);
  assert.equal(Object.keys(first.runtime).some(p => /calibration-model|validation-receipt/.test(p)), false);
  assert.equal(Object.keys(first.tests).some(p => /calibration-model|validation-receipt/.test(p)), false);
  if (first.environment) assertEnvironment156(first.environment, selectedCameraProfile());
});
