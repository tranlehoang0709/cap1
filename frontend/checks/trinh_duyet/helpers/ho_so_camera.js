/** Hồ sơ tường minh; không tự chuyển browser/model khi cấu hình không khớp. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceRoot } from './moi_truong.js';

export const legacyModel = Object.freeze({
  path: 'E:/captone_backup/browser_runs/2026-10-14T10-51-23-245Z/analysis/calibration-model.json',
  sha256: 'e55ed65af650bf84771fff821b5aa5970690bc710bf60c98b4799137eecf39b7',
});
export const renderer = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)';
export const profiles = Object.freeze({
  'chrome-155.0.8059.41': { version: '155.0.8059.41', historical: true },
  'chrome-155.0.8059.86': { version: '155.0.8059.86', historical: false },
  'chrome-156.0.8078.48': { version: '156.0.8078.48', historical: false, isolated: true },
  'chrome-156.0.8078.48-main': { version: '156.0.8078.48', historical: false, main: true },
});

export const chrome156Environment = Object.freeze({
  executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  executableSHA256: '480f275b63d1ea39113cbc8344ac395578acc25b432bd39af5fbc77005179aca',
  python: 'E:/captone_backup/browser_runs/phase3cd_streamlit166_20261027_01/venv166/Scripts/python.exe',
  streamlit: '1.66.0', origin: 'http://localhost:8502',
  dependencySHA256: 'f56c5efd6e99e13d973ca8987b922e4dd8b2a950dc495f77adc5080dc393d191',
});

/** Chỉ đọc interpreter riêng; manifest không chứa đường dẫn model hay digest tự tham chiếu. */
export const chrome156MainEnvironment = Object.freeze({ ...chrome156Environment,
  python: 'E:/captone/frontend/.venv/Scripts/python.exe', origin: 'http://localhost:8501' });

/** Đối chiếu attestation của chính process phục vụ 8501, không suy version từ venv thử nghiệm. */
export function assertMainServerEvidence(evidence, processEvidence) {
  const normalize = value => path.resolve(value || '').toLowerCase();
  if (!Number.isInteger(evidence.pid) || evidence.pid <= 0 || processEvidence.pid !== evidence.pid ||
      !Array.isArray(processEvidence.owners) || !processEvidence.owners.length || processEvidence.owners.some(p => p !== evidence.pid) ||
      evidence.streamlit !== '1.66.0' || normalize(evidence.executable) !== normalize(chrome156MainEnvironment.python) ||
      normalize(evidence.prefix) !== normalize(path.dirname(path.dirname(chrome156MainEnvironment.python))) ||
      !normalize(evidence.streamlitFile).startsWith(normalize(evidence.prefix) + path.sep) ||
      !processEvidence.commandLine?.toLowerCase().replaceAll('/', '\\').includes(evidence.launchScript.toLowerCase().replaceAll('/', '\\')) ||
      normalize(processEvidence.executable) !== normalize(evidence.baseExecutable) ||
      evidence.config['server.port'] !== 8501 || evidence.config['server.enableCORS'] !== true ||
      evidence.config['server.enableXsrfProtection'] !== true || evidence.config['server.headless'] !== true ||
      evidence.config['theme.base'] !== 'dark') throw Error('INCONCLUSIVE: server main/PID/interpreter/config không khớp');
}

async function verifyMainServer(env) {
  if (!env.AIVA_MAIN_SERVER_ATTESTATION || !/^[a-f0-9]{64}$/.test(env.AIVA_MAIN_SERVER_ATTESTATION_SHA256 || '')) {
    throw Error('INCONCLUSIVE: thiếu main server attestation/SHA');
  }
  const body = await fs.readFile(env.AIVA_MAIN_SERVER_ATTESTATION);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (digest(body) !== env.AIVA_MAIN_SERVER_ATTESTATION_SHA256) throw Error('INCONCLUSIVE: attestation SHA');
  const evidence = JSON.parse(body);
  if (!Number.isInteger(evidence.pid) || evidence.pid <= 0) throw Error('INCONCLUSIVE: PID');
  const command = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${evidence.pid}";if(!$p){throw 'Missing main PID'};$owners=@(Get-NetTCPConnection -State Listen -LocalPort 8501 -ErrorAction Stop|Select-Object -ExpandProperty OwningProcess -Unique);@{pid=[int]$p.ProcessId;executable=$p.ExecutablePath;commandLine=$p.CommandLine;owners=$owners}|ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command', command], { timeout: 15000, windowsHide: true });
  const observed = JSON.parse(stdout);
  assertMainServerEvidence(evidence, observed);
  if (digest(await fs.readFile(evidence.launchScript)) !== evidence.launchScriptSHA256 ||
      digest(await fs.readFile(evidence.streamlitFile)) !== evidence.streamlitFileSHA256 ||
      digest(await fs.readFile(evidence.recordFile)) !== evidence.recordSHA256) throw Error('INCONCLUSIVE: server module/launcher đổi');
  // PID/command line là bằng chứng mỗi lần đo; không tạo fingerprint phụ thuộc PID qua các lần khởi động hợp lệ.
  const { runDir } = await import('./moi_truong.js');
  await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true });
  await fs.appendFile(path.join(runDir, 'analysis/main-server-observations.jsonl'), JSON.stringify({ evidence, observed }) + '\n');
  return { executable: evidence.executable, prefix: evidence.prefix, streamlit: evidence.streamlit,
    streamlitFile: evidence.streamlitFile, streamlitFileSHA256: evidence.streamlitFileSHA256,
    recordSHA256: evidence.recordSHA256, launchScriptSHA256: evidence.launchScriptSHA256, config: evidence.config };
}

export async function cameraEnvironment156(env = process.env, profile = selectedCameraProfile(env)) {
  const locked = profile.main ? chrome156MainEnvironment : chrome156Environment;
  if (env.AIVA_TEST_ORIGIN !== locked.origin) throw Error('INCONCLUSIVE: Chrome156 origin không khớp profile');
  const { stdout } = await promisify(execFile)(locked.python, ['-B', '-c',
    'import importlib.metadata as m,json,sys;print(json.dumps({"python":sys.version,"prefix":sys.prefix,"packages":{d.metadata["Name"].lower().replace("-","_"):d.version for d in m.distributions()}}))'],
  { env: { ...env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 15000 });
  const data = JSON.parse(stdout);
  data.packages = Object.fromEntries(Object.entries(data.packages).sort(([a], [b]) => a.localeCompare(b)));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const observed = { ...data, streamlit: data.packages.streamlit, origin: env.AIVA_TEST_ORIGIN,
    executableSHA256: digest(await fs.readFile(locked.executable)),
    pythonExecutableSHA256: digest(await fs.readFile(locked.python)),
    dependencySHA256: digest(JSON.stringify(data.packages)) };
  if (profile.main) observed.server = await verifyMainServer(env);
  assertEnvironment156(observed, profile);
  return observed;
}

export function assertEnvironment156(observed, profile = { isolated: true }) {
  const locked = profile.main ? chrome156MainEnvironment : chrome156Environment;
  if (observed.streamlit !== locked.streamlit || observed.origin !== locked.origin ||
      observed.executableSHA256 !== locked.executableSHA256 || observed.dependencySHA256 !== locked.dependencySHA256 ||
      profile.main && (!observed.server || observed.server.streamlit !== '1.66.0' ||
        path.resolve(observed.prefix || '').toLowerCase() !== path.resolve('E:/captone/frontend/.venv').toLowerCase())) {
    throw Error('INCONCLUSIVE: môi trường Chrome156/Streamlit riêng không khớp');
  }
}

export function selectedCameraProfile(env = process.env) {
  const id = env.AIVA_CAMERA_PROFILE;
  if (!Object.hasOwn(profiles, id)) throw Error('INCONCLUSIVE: phải chọn AIVA_CAMERA_PROFILE có trong registry');
  return { id, ...profiles[id] };
}

export function cameraModelReference(env = process.env) {
  const profile = selectedCameraProfile(env);
  if (profile.historical) {
    if (env.AIVA_CAMERA_MODEL && path.resolve(env.AIVA_CAMERA_MODEL) !== path.resolve(legacyModel.path) ||
        env.AIVA_CAMERA_MODEL_SHA256 && env.AIVA_CAMERA_MODEL_SHA256 !== legacyModel.sha256) {
      throw Error('INCONCLUSIVE: không được thay model .41 bằng model khác');
    }
    return legacyModel;
  }
  if (!env.AIVA_CAMERA_MODEL || !/^[a-f0-9]{64}$/.test(env.AIVA_CAMERA_MODEL_SHA256 || '')) {
    throw Error('INCONCLUSIVE: profile .86 cần đường dẫn model và SHA-256 tường minh');
  }
  if (path.resolve(env.AIVA_CAMERA_MODEL) === path.resolve(legacyModel.path)) throw Error('INCONCLUSIVE: .86 không được dùng model .41');
  return { path: env.AIVA_CAMERA_MODEL, sha256: env.AIVA_CAMERA_MODEL_SHA256 };
}

export function assertCameraFingerprint(profile, observed) {
  const common = observed.browserVersion === profile.version && observed.channel === 'chrome' &&
    observed.viewport.width === 1440 && observed.viewport.height === 1080 && observed.dpr === 1 &&
    observed.renderer === renderer;
  // Hồ sơ cũ không có metadata OS/vendor/canvas: không điền hồi tố hoặc siết giả lịch sử.
  const modern = profile.historical || observed.os === 'win32' && observed.gpuVendor === 'Google Inc. (Intel)' &&
    observed.backend === 'D3D11' && observed.webglVersion === 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' &&
    observed.threeRevision === '180' && observed.hero === false &&
    observed.canvasCSS.width === 305 && observed.canvasCSS.height === 142 &&
    observed.drawingBuffer.width === 305 && observed.drawingBuffer.height === 142;
  if (profile.isolated || profile.main) assertEnvironment156(observed.environment || {}, profile);
  if (!common || !modern) throw Error(`INCONCLUSIVE: fingerprint không khớp ${profile.id}: ${JSON.stringify(observed)}`);
}

const runtimeInputs = [
  'app.py', 'nen_tang/chu_de.py', 'kieu_dang/portal.css', 'kieu_dang/components.css',
  'giao_dien/nguoi_dung/bang_dieu_khien.py', 'thanh_phan/robot/khung_hien_thi.py',
  'thanh_phan/robot/tai_lieu_3d.py',
  ...['scene.js', 'model.js', 'controls.js', 'theme.js', 'style.css', 'template.html',
    'diagnostics.js', 'robot.bundle.js', 'package.json', 'package-lock.json'].map(n => `ui/assets/aiva3d/${n}`),
];
const testInputs = [
  'helpers/ho_so_camera.js', 'helpers/ho_so_camera.test.js', 'helpers/robot.js', 'helpers/kiem_tra_moi_truong.js',
  'helpers/vong_doi_iframe.js', 'helpers/chu_de.js', 'helpers/moi_truong.js',
  'fixtures/phien_demo.js', 'specs/robot.spec.js', 'playwright.config.js', 'package-lock.json',
].map(n => `checks/trinh_duyet/${n}`);

export async function cameraChecksums() {
  const hash = async names => Object.fromEntries(await Promise.all(names.map(async name =>
    [name, createHash('sha256').update(await fs.readFile(path.join(sourceRoot, name))).digest('hex')])));
  const evidence = { runtime: await hash(runtimeInputs), tests: await hash(testInputs) };
  if (['chrome-156.0.8078.48', 'chrome-156.0.8078.48-main'].includes(process.env.AIVA_CAMERA_PROFILE)) evidence.environment = await cameraEnvironment156();
  if (process.env.AIVA_CAMERA_PROFILE === 'chrome-156.0.8078.48-main') {
    Object.assign(evidence.tests, await hash(['helpers/loi_trinh_duyet.js', 'helpers/bao_mat.test.js', 'helpers/chay_kiem_thu.js', 'helpers/bo_cuc.js'].map(n => `checks/trinh_duyet/${n}`)));
  }
  return evidence;
}

/** Receipt riêng giữ model bất biến; chỉ cho phép candidate đã có đủ tám lượt validation độc lập. */
export function assertCameraValidationReceipt(receipt, model, modelSHA256) {
  if (receipt.status !== 'VALIDATED_PENDING_USER_ACCEPTANCE' || receipt.approved !== false ||
      receipt.profileId !== model.profileId || receipt.modelSHA256 !== modelSHA256 ||
      !sameEvidence(receipt.checksums, model.checksums) || !Array.isArray(receipt.cases) || receipt.cases.length !== 8 ||
      new Set(receipt.cases.map(c => c.caseId)).size !== 8 ||
      receipt.cases.some((c, i) => c.caseId !== `metric-validation-${String(i).padStart(2, '0')}` ||
        c.split !== 'validation' || c.view !== (i % 2 ? 'right-3-zoomout-2' : 'left-3-zoomout-2') ||
        !/^[a-f0-9]{64}$/.test(c.rawSHA256 || '') || !/^[a-f0-9]{64}$/.test(c.evaluationSHA256 || '') ||
        c.results?.length !== 15 || c.results.some(r => r.status !== 'PASS') ||
        ['dark', 'light'].some(theme => ['positive', 'focus-normalized', 'theme', 'negative-rotation', 'negative-zoom', 'negative-drag2px', 'reset']
          .some(kind => c.results.filter(r => r.theme === theme && r.kind === kind).length !== 1)) ||
        c.results.filter(r => r.theme === 'dark' && r.kind === 'default-restoration').length !== 1)) {
    throw Error('INCONCLUSIVE: candidate chưa có validation receipt hợp lệ');
  }
}

export function sameEvidence(left, right) {
  const canonical = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
    : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
