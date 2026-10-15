import { test, expect } from '../fixtures/phien_demo.js';
import { robotFrame, pauseRobot, canvasHash, settleReset, neutralCanvasFocus, captureCanvasDiagnostic, calculateCameraMetrics, evaluateCameraMetrics, loadCameraModel, requireCameraProfile, cameraModelSHA256 } from '../helpers/robot.js';
import { createHash } from 'node:crypto';
import { setTheme } from '../helpers/chu_de.js';
import { inspectRobot, preserveIdentity, compareIdentity, watchFrames, reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { capture } from '../helpers/bo_cuc.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runDir } from '../helpers/moi_truong.js';

test.use({ demoRole: 'user' });

// Thiết kế cố định trước thu mẫu: 12 train/8 validation, hai view, DPR 1.
// Không chạy bằng tag @robot thông thường; không thay hash assertion hiện hữu.
for (const split of process.env.AIVA_CAMERA_COLLECTION ? [process.env.AIVA_CAMERA_COLLECTION] : ['acceptance']) {
  if (!['train', 'validation', 'acceptance'].includes(split)) throw Error('BLOCKED: camera collection mode không hợp lệ');
  const count = split === 'train' ? 12 : split === 'validation' ? 8 : 1;
  for (let index = 0; index < count; index++) test(`Camera ${split} ${index} ${split === 'acceptance' ? '@camera' : '@camera_collect_' + (split === 'train' ? 'calibration' : 'validation')}`, async ({ page }, testInfo) => {
    await requireCameraProfile(page);
    const directory = path.join(runDir, 'analysis');
    await fs.mkdir(directory, { recursive: true });
    const caseId = `metric-${split}-${String(index).padStart(2, '0')}`;
    const data = { caseId, split, profile: { width: 1440, height: 1080, dpr: 1 }, view: index % 2 === 0 ? 'left-3-zoomout-2' : 'right-3-zoomout-2', images: {}, pairs: [], status: 'INCONCLUSIVE_UNCALIBRATED' };
    let model;
    if (split === 'acceptance') {
      model = await loadCameraModel();
      data.modelSHA256 = cameraModelSHA256;
    } else if (split === 'validation') {
      if (!process.env.AIVA_CAMERA_MODEL || !process.env.AIVA_CAMERA_MODEL_SHA256) throw Error('BLOCKED: cần model đã đóng băng và SHA-256 trước validation');
      const body = await fs.readFile(process.env.AIVA_CAMERA_MODEL, 'utf8');
      data.modelSHA256 = createHash('sha256').update(body).digest('hex');
      expect(data.modelSHA256).toBe(process.env.AIVA_CAMERA_MODEL_SHA256);
      model = JSON.parse(body);
      expect(model.status).toBe('FROZEN_CANDIDATE_NOT_APPROVED');
    }
    expect(page.viewportSize()).toEqual({ width: 1440, height: 1080 });
    const frame = await robotFrame(page);
    const identity = await preserveIdentity(frame);
    const observer = watchFrames(page);
    const initial = await inspectRobot(frame);
    const shoot = async label => {
      await neutralCanvasFocus(frame);
      const name = `${caseId}-${label}`;
      data.images[name] = await captureCanvasDiagnostic(frame, name, identity);
      return name;
    };
    const pair = (name, theme, kind, left, right) => data.pairs.push({ name: `${caseId}-${name}`, theme, kind, left, right });
    const key = async value => { await frame.locator('canvas').press(value); };
    const view = async () => {
      for (let i = 0; i < 3; i++) await key(index % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
      await key('-'); await key('-');
    };
    const focusControl = async (theme, reference) => {
      await frame.locator('canvas').press('Shift');
      const focused = `${caseId}-${theme}-focus-raw`;
      data.images[focused] = await captureCanvasDiagnostic(frame, focused, identity);
      expect(data.images[focused].before.focusVisible).toBe(true);
      pair(`${theme}-focus-raw`, theme, 'focus-raw', reference, focused);
      const restored = await shoot(`${theme}-focus-normalized`);
      pair(`${theme}-focus-normalized`, theme, 'focus-normalized', reference, restored);
    };
    const negatives = async (theme, reference) => {
      await key('ArrowLeft');
      const rotated = await shoot(`${theme}-rotated`);
      pair(`${theme}-rotation`, theme, 'negative-rotation', reference, rotated);
      await key('-');
      const zoomed = await shoot(`${theme}-zoomed`);
      pair(`${theme}-zoom`, theme, 'negative-zoom', rotated, zoomed);
      const box = await frame.locator('canvas').boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 2, y, { steps: 2 }); await page.mouse.up();
      const dragged = await shoot(`${theme}-dragged`);
      pair(`${theme}-drag2px`, theme, 'negative-drag2px', zoomed, dragged);
      await frame.getByRole('button', { name: 'Reset', exact: true }).click();
      const reset = await shoot(`${theme}-reset`);
      pair(`${theme}-reset`, theme, 'reset', dragged, reset);
      return reset;
    };
    const theme = async dark => {
      const previous = reruns(page).length;
      const oldFrames = await frame.evaluate(() => window.__AIVA3D__.framesRendered);
      await setTheme(page, dark); await waitForRerun(page, previous);
      const current = await robotFrame(page);
      expect(current).toBe(frame);
      expect(frame.isDetached()).toBe(false);
      expect(await compareIdentity(identity, current)).toEqual({ oldConnected: true, sameElement: true, sameDocument: true, sameCanvas: true, sameDiagnostics: true });
      await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.theme)).toBe(dark ? 'dark' : 'light');
      await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.framesRendered)).toBeGreaterThan(oldFrames);
      expect(await frame.evaluate(() => performance.timeOrigin)).toBe(initial.timeOrigin);
      expect(await frame.evaluate(() => window.__AIVA3D__.rendererInitializations)).toBe(initial.diagnostics.rendererInitializations);
    };
    try {
      await pauseRobot(frame);
      await expect(frame.getByRole('button', { name: 'Tiếp tục', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const defaultDark = await shoot('dark-default');
      await view();
      const darkReference = await shoot('dark-reference');
      const darkRepeat = await shoot('dark-repeat');
      pair('dark-positive', 'dark', 'positive', darkReference, darkRepeat);
      await focusControl('dark', darkReference);
      const resetDark = await negatives('dark', darkReference);
      pair('dark-default-restoration', 'dark', 'default-restoration', defaultDark, resetDark);
      await view();
      const beforeThemeDark = await shoot('dark-before-theme');
      expect((await inspectRobot(frame)).layout.flashPresent).toBe(true);
      await theme(false);
      const lightReference = await shoot('light-reference');
      const lightRepeat = await shoot('light-repeat');
      pair('light-positive', 'light', 'positive', lightReference, lightRepeat);
      await focusControl('light', lightReference);
      await theme(true);
      const afterThemeDark = await shoot('dark-after-theme');
      pair('dark-theme', 'dark', 'theme', beforeThemeDark, afterThemeDark);
      await theme(false);
      const afterThemeLight = await shoot('light-after-theme');
      pair('light-theme', 'light', 'theme', lightReference, afterThemeLight);
      await negatives('light', afterThemeLight);
      expect(observer.events.filter(event => event.id === observer.id(frame))).toEqual([]);
      data.status = 'COLLECTED_NOT_ACCEPTED';
      const casePath = path.join(directory, `${caseId}.json`);
      await fs.writeFile(casePath, JSON.stringify(data, null, 2));
      const metrics = await calculateCameraMetrics(casePath);
      if (model) {
        const evaluation = { caseId, modelSHA256: data.modelSHA256, results: evaluateCameraMetrics(metrics, model) };
        await fs.writeFile(path.join(directory, `${caseId}.evaluation.json`), JSON.stringify(evaluation, null, 2));
        for (const result of evaluation.results) expect.soft(result.status, `${result.name}: ${result.classification}, không đổi INCONCLUSIVE thành PASS`).toBe('PASS');
      } else {
        testInfo.annotations.push({ type: 'calibration', description: 'Chỉ thu mẫu/lifecycle; chưa phân loại camera PASS, chưa phê duyệt assertion' });
      }
    } finally {
      data.frameEvents = observer.events; observer.stop();
      await fs.writeFile(path.join(directory, `${caseId}.json`), JSON.stringify(data, null, 2));
      await identity.dispose();
    }
  });
}

async function assertCamera(page, frame) {
  await pauseRobot(frame);
  const original = await settleReset(frame);
  const canvas = frame.locator('canvas'), box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * .2, y, { steps: 12 });
  await page.mouse.up();
  const rotated = await canvasHash(frame);
  expect(rotated).not.toBe(original);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => canvasHash(frame)).not.toBe(rotated);
  await expect.poll(() => settleReset(frame)).toBe(original);
}

test('Wave độc lập, lặp lại và trở về resting pose @robot', async ({ page }, testInfo) => {
  const frame = await robotFrame(page);
  const evidence = [];
  try {
    await expect(frame.getByRole('button', { name: 'Vẫy tay', exact: true })).toBeEnabled();
    for (let round = 0; round < 2; round++) {
      const waving = page.waitForEvent('console', { predicate: m => m.text().includes('[AIVA3D] Arm poses waving') });
      const idle = page.waitForEvent('console', { predicate: m => m.text().includes('[AIVA3D] Arm poses idle'), timeout: 15000 });
      await frame.getByRole('button', { name: 'Vẫy tay', exact: true }).click();
      const start = await waving;
      const startPoses = await start.args()[2].jsonValue();
      const count = await frame.evaluate(() => window.__AIVA3D__.framesRendered);
      await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.framesRendered)).toBeGreaterThan(count + 10);
      await capture(page, `wave-${round + 1}-moving`);
      const end = await idle;
      const endPoses = await end.args()[2].jsonValue();
      for (const poses of [startPoses, endPoses]) {
        expect(poses).toHaveLength(2);
        for (const pose of poses) { expect(pose.visible).toBe(true); expect(pose.finiteWorldMatrix).toBe(true); }
      }
      evidence.push({ startPoses, endPoses });
      expect(await frame.evaluate(() => window.__AIVA3D__.lastError)).toBeNull();
    }
    const resting = poses => poses.map(({ side, localPosition, localRotation, elbowRotation }) => ({ side, localPosition, localRotation, elbowRotation }));
    expect(resting(evidence[1].endPoses)).toEqual(resting(evidence[0].endPoses));
    await capture(page, 'wave-returned-idle');
  } finally {
    await testInfo.attach('wave-poses.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  }
});

// Test chẩn đoán riêng; không thay assertion hash hoặc lifecycle cũ ở bên dưới.
if (process.env.AIVA_CAMERA_DIAGNOSTIC === '1') test('Đối chứng focus, theme và Reset camera @camera_diagnostic', async ({ page }, testInfo) => {
  const directory = path.join(runDir, 'analysis');
  await fs.mkdir(directory, { recursive: true });
  const summary = { groups: { A: { status: 'NOT RUN' }, B: { status: 'NOT RUN' }, C: { status: 'NOT RUN' } }, images: {} };
  const frame = await robotFrame(page);
  const identity = await preserveIdentity(frame);
  const observer = watchFrames(page);
  const sameIdentity = state => Object.values(state).every(value => value === true);
  const shoot = async name => {
    const image = await captureCanvasDiagnostic(frame, name, identity);
    summary.images[name] = image;
    return image;
  };
  try {
    await pauseRobot(frame);
    await expect(frame.getByRole('button', { name: 'Tiếp tục', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.theme)).toBe('dark');
    await neutralCanvasFocus(frame);
    const defaultView = await shoot('default-dark');

    // Đúng chuỗi ArrowLeft/+ của assertion đang FAIL, không reset giữa A và B.
    await frame.locator('canvas').press('ArrowLeft');
    await frame.locator('canvas').press('+');
    await neutralCanvasFocus(frame);
    const first = await shoot('A-reference-dark');
    const second = await shoot('A-repeat-dark');
    const changedView = first.sha256 !== defaultView.sha256;
    summary.groups.A = { status: first.sha256 === second.sha256 && changedView ? 'PASS' : 'INCONCLUSIVE', equal: first.sha256 === second.sha256, changedFromDefault: changedView };

    // Shift không có handler camera; chỉ tạo điều kiện keyboard focus tương tự test cũ.
    await frame.locator('canvas').press('Shift');
    const focusView = await shoot('A-canvas-keyboard-focus');
    await neutralCanvasFocus(frame);
    const restoredFocus = await shoot('A-neutral-focus-restored');
    summary.focusContrast = {
      focusVisible: focusView.before.focusVisible,
      differsFromNeutral: focusView.sha256 !== second.sha256,
      neutralRestoredEqual: restoredFocus.sha256 === second.sha256,
    };

    summary.beforeTheme = await inspectRobot(frame);
    summary.themeTransitions = [];
    for (const dark of [false, true]) {
      const previous = reruns(page).length;
      const oldFrames = await frame.evaluate(() => window.__AIVA3D__.framesRendered);
      await setTheme(page, dark);
      await waitForRerun(page, previous);
      const current = await robotFrame(page);
      const state = await compareIdentity(identity, current);
      summary.themeTransitions.push({ dark, sameFrame: current === frame, identity: state });
      if (current !== frame || !sameIdentity(state)) {
        summary.groups.B = { status: 'FAIL', reason: 'Iframe/document/canvas/diagnostics thay đổi' };
        throw Error('Lifecycle continuity FAIL trong thử nghiệm chẩn đoán');
      }
      await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.theme)).toBe(dark ? 'dark' : 'light');
      await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.framesRendered)).toBeGreaterThan(oldFrames);
    }
    await neutralCanvasFocus(frame);
    const afterTheme = await shoot('B-after-theme-dark');
    const initialized = first.before.rendererInitializations === afterTheme.before.rendererInitializations;
    const origin = first.before.timeOrigin === afterTheme.before.timeOrigin;
    summary.groups.B = {
      status: !initialized || !origin ? 'FAIL' : first.sha256 === afterTheme.sha256 ? 'PASS' : 'INCONCLUSIVE',
      equal: first.sha256 === afterTheme.sha256, sameTimeOrigin: origin, sameInitializationCount: initialized,
    };

    const beforeReset = await shoot('C-before-reset');
    await frame.getByRole('button', { name: 'Reset', exact: true }).click();
    await neutralCanvasFocus(frame);
    const afterReset = await shoot('C-after-reset');
    summary.groups.C = {
      status: beforeReset.sha256 !== afterReset.sha256 && afterReset.sha256 === defaultView.sha256 ? 'PASS' : 'INCONCLUSIVE',
      resetDetected: beforeReset.sha256 !== afterReset.sha256,
      returnsToDefault: afterReset.sha256 === defaultView.sha256,
    };
    for (const [name, group] of Object.entries(summary.groups)) {
      expect.soft(group.status, `Đối chứng ${name}: ${group.status}; không coi INCONCLUSIVE là PASS`).toBe('PASS');
    }
  } catch (error) {
    summary.error = error.message;
    throw error;
  } finally {
    summary.frameEvents = observer.events;
    observer.stop();
    await fs.writeFile(path.join(directory, 'camera-diagnostic.json'), JSON.stringify(summary, null, 2));
    await testInfo.attach('camera-diagnostic.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
    await identity.dispose();
  }
});

test('WebGL, kéo xoay, zoom và reset độc lập @robot', async ({ page }, testInfo) => {
  const frame = await robotFrame(page);
  await assertCamera(page, frame);
  await testInfo.attach('renderer.json', { body: JSON.stringify(await inspectRobot(frame), null, 2), contentType: 'application/json' });
});

// Giữ kiểm tra thất bại và toàn bộ điều kiện giữ renderer; chỉ thêm bằng chứng.
test('WebGL, kéo xoay, zoom, reset, wave và theme không reload @robot @lifecycle', async ({ page }, testInfo) => {
  await requireCameraProfile(page);
  const model = await loadCameraModel();
  const frame = await robotFrame(page);
  await assertCamera(page, frame);
  // Camera khác mặc định; so ảnh cùng Dark khi pause để kiểm tra view qua theme.
  for (let i = 0; i < 3; i++) await frame.locator('canvas').press('ArrowLeft');
  await frame.locator('canvas').press('-');
  await frame.locator('canvas').press('-');
  const identity = await frame.evaluateHandle(() => window.__AIVA3D__);
  const count = await frame.evaluate(() => window.__AIVA3D__.rendererInitializations);
  expect(count).toBeGreaterThan(0);
  const parentIdentity = await preserveIdentity(frame);
  const observer = watchFrames(page);
  const directory = path.join(runDir, 'analysis');
  await fs.mkdir(directory, { recursive: true });
  const cameraCase = { caseId: 'lifecycle-camera', split: 'acceptance', profile: model.profile, view: 'left-3-zoomout-2', images: {}, pairs: [] };
  const shot = async name => { await neutralCanvasFocus(frame); cameraCase.images[name] = await captureCanvasDiagnostic(frame, name, parentIdentity); return name; };
  const references = { dark: await shot('lifecycle-dark-reference') };
  const evidence = { before: await inspectRobot(frame), modelSHA256: cameraModelSHA256, initialFrame: observer.id(frame), initialReruns: [...reruns(page)], transitions: [] };
  expect(evidence.before.layout.flashPresent, 'Đo từ trước rerun tiêu thụ flash').toBe(true);
  let previousIdentity = parentIdentity;
  const handles = [parentIdentity];
  try {
    for (const dark of [false, true, false]) {
      const previousCount = reruns(page).length;
      const previousFrames = await frame.evaluate(() => window.__AIVA3D__.framesRendered);
      const changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
      await setTheme(page, dark);
      if (changed) await waitForRerun(page, previousCount);
      const current = await robotFrame(page);
      await expect.poll(() => current.evaluate(() => window.__AIVA3D__.theme)).toBe(dark ? 'dark' : 'light');
      await expect.poll(() => current.evaluate(() => window.__AIVA3D__.framesRendered)).toBeGreaterThan(previousFrames);
      const transition = {
        dark, changed, at: Date.now(), currentFrame: observer.id(current),
        oldDetached: frame.isDetached(), sameFrame: frame === current,
        identity: await compareIdentity(parentIdentity, current), after: await inspectRobot(current),
        previousIdentity: await compareIdentity(previousIdentity, current),
        reruns: [...reruns(page)],
      };
      evidence.transitions.push(transition);
      await capture(page, `robot-theme-${dark ? 'dark' : 'light'}`);
      // Reacquire chỉ để đo cảnh mới; không thay thế assertion bảo toàn identity.
      expect.soft(transition.identity, 'Theme phải giữ iframe/document/canvas/renderer gốc').toEqual({
        oldConnected: true, sameElement: true, sameDocument: true, sameCanvas: true, sameDiagnostics: true,
      });
      expect.soft(frame === current, 'Không chấp nhận iframe reload').toBe(true);
      const originalDiagnostics = frame.isDetached() ? false : await identity.evaluate(d => d === window.__AIVA3D__);
      expect.soft(originalDiagnostics, 'Diagnostics gốc phải được giữ').toBe(true);
      expect.soft(await current.evaluate(() => window.__AIVA3D__.rendererInitializations)).toBe(count);
      expect.soft(transition.after.timeOrigin).toBe(evidence.before.timeOrigin);
      expect.soft(transition.after.diagnostics.framesRendered).toBeGreaterThanOrEqual(evidence.before.diagnostics.framesRendered);
      expect.soft(frame.isDetached()).toBe(false);
      // Không chụp ảnh thay thế để che lifecycle vi phạm.
      expect(transition.sameFrame && !transition.oldDetached).toBe(true);
      const themeName = dark ? 'dark' : 'light';
      const image = await shot(`lifecycle-${themeName}-${evidence.transitions.length}`);
      if (references[themeName]) cameraCase.pairs.push({ name: `lifecycle-${themeName}`, theme: themeName, kind: 'theme', left: references[themeName], right: image });
      else references[themeName] = image;
      previousIdentity = await preserveIdentity(current);
      handles.push(previousIdentity);
    }
    expect.soft(observer.events.filter(event => event.id === observer.id(frame)), 'Không detach/navigation lại iframe gốc').toEqual([]);
    const casePath = path.join(directory, 'lifecycle-camera.json');
    await fs.writeFile(casePath, JSON.stringify(cameraCase, null, 2));
    const metrics = await calculateCameraMetrics(casePath);
    evidence.cameraEvaluation = evaluateCameraMetrics(metrics, model);
    for (const result of evidence.cameraEvaluation) expect.soft(result.status, `${result.name}: ${result.classification}; không nghiệm thu INCONCLUSIVE`).toBe('PASS');
  } finally {
    evidence.frameEvents = observer.events;
    observer.stop();
    await testInfo.attach('iframe-lifecycle.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    for (const handle of handles) await handle.dispose();
    await identity.dispose();
  }
});
