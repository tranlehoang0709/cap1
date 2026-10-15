/** Dùng diagnostics và controls hiện có, không thêm hook vào runtime. */
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runDir, sourceRoot } from './moi_truong.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareIdentity } from './vong_doi_iframe.js';

export const cameraModelPath = 'E:/captone_backup/browser_runs/2026-10-14T10-51-23-245Z/analysis/calibration-model.json';
export const cameraModelSHA256 = 'e55ed65af650bf84771fff821b5aa5970690bc710bf60c98b4799137eecf39b7';

/** Chỉ đọc mô hình đã khóa; không hiệu chỉnh lại khi nghiệm thu. */
export async function loadCameraModel() {
  const body = await fs.readFile(cameraModelPath, 'utf8');
  expect(createHash('sha256').update(body).digest('hex'), 'Tính toàn vẹn mô hình calibration').toBe(cameraModelSHA256);
  return JSON.parse(body);
}

/** Profile khác không đủ điều kiện nghiệm thu, không skip để làm xanh test. */
export async function requireCameraProfile(page) {
  const environment = JSON.parse(await fs.readFile(path.join(runDir, 'environment.json'), 'utf8'));
  const profile = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  const valid = environment.version === '155.0.8059.41' && profile.width === 1440 && profile.height === 1080 && profile.dpr === 1;
  if (!valid) throw Error(`INCONCLUSIVE: profile chưa hiệu chuẩn ${JSON.stringify({ version: environment.version, ...profile })}`);
  // Fingerprint của máy vừa chạy các đối chứng nghiệm thu với mô hình khóa.
  // Không tuyên bố đây là fingerprint lịch sử của bộ calibration cũ.
  const frame = await robotFrame(page);
  const renderer = await frame.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (renderer !== 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)') throw Error(`INCONCLUSIVE: GPU/rendering profile khác lượt đối chứng nghiệm thu: ${renderer}`);
}

export async function robotFrame(page) {
  let found;
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.locator('#stage').count().catch(() => 0)) { found = frame; return true; }
    return false;
  }).toBe(true);
  const iframe = await found.frameElement();
  await iframe.scrollIntoViewIfNeeded();
  await expect.poll(() => found.evaluate(() => {
    const d = window.__AIVA3D__;
    return !!d?.rendererInitialized && d.framesRendered > 0 && d.drawCalls > 0 && !d.lastError;
  })).toBe(true);
  await expect(found.locator('#fallback')).toBeHidden();
  return found;
}
export async function pauseRobot(frame) {
  const pause = frame.getByRole('button', { name: 'Dừng', exact: true });
  if (await pause.count() && await pause.isEnabled()) await pause.click();
}
export async function canvasHash(frame) {
  return createHash('sha256').update(await frame.locator('canvas').screenshot()).digest('hex');
}
export async function settleReset(frame) {
  let previous;
  for (let i = 0; i < 8; i++) {
    await frame.getByRole('button', { name: 'Reset', exact: true }).click();
    const current = await canvasHash(frame);
    if (current === previous) return current;
    previous = current;
  }
  throw Error('Ảnh canvas không ổn định sau reset khi pause');
}

/** Chỉ chuyển focus, không phát click/drag/key reset hoặc thay camera. */
export async function neutralCanvasFocus(frame) {
  await frame.getByRole('button', { name: 'Reset', exact: true }).focus();
  await expect.poll(() => frame.locator('canvas').evaluate(canvas => ({
    focused: document.activeElement === canvas,
    focusVisible: canvas.matches(':focus-visible'),
    activeId: document.activeElement?.id,
  }))).toEqual({ focused: false, focusVisible: false, activeId: 'reset' });
}

export async function canvasMetadata(frame, identity) {
  const metadata = await frame.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const describe = node => node ? { tag: node.tagName, id: node.id || null, role: node.getAttribute('role') } : null;
    const diagnostics = window.__AIVA3D__;
    return {
      timestamp: new Date().toISOString(), theme: diagnostics.theme,
      activeElement: describe(document.activeElement),
      parentActiveElement: describe(parent.document.activeElement),
      focused: document.activeElement === canvas, focusVisible: canvas.matches(':focus-visible'),
      focusOutline: { style: getComputedStyle(canvas).outlineStyle, width: getComputedStyle(canvas).outlineWidth, offset: getComputedStyle(canvas).outlineOffset, color: getComputedStyle(canvas).outlineColor },
      rect: canvas.getBoundingClientRect().toJSON(), width: canvas.width, height: canvas.height,
      drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, contextLost: gl.isContextLost() } : null,
      renderingProfile: gl ? (() => {
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        return { version: gl.getParameter(gl.VERSION), vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null, renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null };
      })() : null,
      devicePixelRatio, framesRendered: diagnostics.framesRendered,
      viewport: { width: innerWidth, height: innerHeight, parentWidth: parent.innerWidth, parentHeight: parent.innerHeight },
      inViewport: (() => { const r = canvas.getBoundingClientRect(), f = window.frameElement?.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && !!f && f.top >= 0 && f.bottom <= parent.innerHeight && f.left >= 0 && f.right <= parent.innerWidth; })(),
      rendererInitializations: diagnostics.rendererInitializations,
      timeOrigin: performance.timeOrigin, lastError: diagnostics.lastError,
      status: document.getElementById('status').textContent,
      pausePressed: document.getElementById('pause').getAttribute('aria-pressed'),
    };
  });
  return { ...metadata, identity: await compareIdentity(identity, frame) };
}

// Pillow đã có trong .venv. Không tạo script runtime, không cài dependency.
// Biên là tương phản luminance 4 láng giềng, không phải silhouette 3D thật.
const metricScript = String.raw`
import sys,json,hashlib,statistics,math
from pathlib import Path
from PIL import Image
case_path=Path(sys.argv[1]); case=json.loads(case_path.read_text(encoding='utf-8')); directory=case_path.parent
edge_levels=[16,32,64]; bright_levels=[96,128,160,192]; cache={}
def describe(points):
 if not points:return dict(area=0,bbox=None,centroid=None)
 return dict(area=len(points),bbox=[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points)+1,max(y for x,y in points)+1],centroid=[sum(x for x,y in points)/len(points),sum(y for x,y in points)/len(points)])
def load(name):
 if name in cache:return cache[name]
 meta=case['images'][name]; content=(directory/meta['png']).read_bytes()
 assert hashlib.sha256(content).hexdigest()==meta['sha256'],'PNG checksum changed'
 im=Image.open(directory/meta['png']).convert('RGB'); w,h=im.size; pixels=list(im.getdata()); gray=list(im.convert('L').getdata())
 contrasts={}
 for y in range(1,h-1):
  for x in range(1,w-1):
   i=y*w+x; contrasts[(x,y)]=max(abs(gray[i]-gray[j]) for j in (i-1,i+1,i-w,i+w))
 edges={t:{p for p,v in contrasts.items() if v>=t} for t in edge_levels}
 bright={t:{(i%w,i//w) for i,p in enumerate(pixels) if min(p)>=t} for t in bright_levels}
 cache[name]=dict(size=(w,h),pixels=pixels,edges=edges,bright=bright,distances={})
 return cache[name]
def overlap(a,b):return len(a&b)/len(a|b) if a|b else None
def distance_map(image):
 if 32 in image['distances']:return image['distances'][32]
 w,h=image['size']; distances=[w+h]*(w*h)
 for x,y in image['edges'][32]:distances[y*w+x]=0
 for y in range(h):
  for x in range(w):
   i=y*w+x
   if x:distances[i]=min(distances[i],distances[i-1]+1)
   if y:distances[i]=min(distances[i],distances[i-w]+1)
 for y in range(h-1,-1,-1):
  for x in range(w-1,-1,-1):
   i=y*w+x
   if x+1<w:distances[i]=min(distances[i],distances[i+1]+1)
   if y+1<h:distances[i]=min(distances[i],distances[i+w]+1)
 image['distances'][32]=distances;return distances
results=[]
for pair in case['pairs']:
 a=load(pair['left']); b=load(pair['right']); ma=case['images'][pair['left']];mb=case['images'][pair['right']]
 issues=[]
 for m in [ma,mb]:
  for phase in ['before','after']:
   q=m[phase]
   if not all(q['identity'].values()):issues.append('identity')
   if q['pausePressed']!='true':issues.append('not-paused')
   if q['focusVisible'] or q['focused'] or q['activeElement']['id']!='reset':issues.append('focus-precondition')
   if q['lastError'] or q['drawingBuffer']['contextLost']:issues.append('renderer-error')
   if q.get('inViewport') is False:issues.append('offscreen')
   if q['framesRendered']<1:issues.append('no-frame')
   if q['devicePixelRatio']!=case['profile']['dpr'] or q['viewport']['parentWidth']!=case['profile']['width'] or q['viewport']['parentHeight']!=case['profile']['height']:issues.append('uncalibrated-profile')
  if m['before']['framesRendered']!=m['after']['framesRendered']:issues.append('render-during-capture')
 for key in ['width','height','drawingBuffer','devicePixelRatio','theme','timeOrigin','rendererInitializations','renderingProfile']:
  if key not in ma['before'] or key not in mb['before']:continue
  if ma['before'][key]!=mb['before'][key]:issues.append('metadata-'+key)
 if a['size']!=b['size']:issues.append('PNG-size')
 result=dict(pair,quality='VALID' if not issues else 'INCONCLUSIVE',qualityIssues=sorted(set(issues)))
 if a['size']==b['size']:
  w,h=a['size']; differences=[max(abs(p[i]-q[i]) for i in range(3)) for p,q in zip(a['pixels'],b['pixels'])]
  result['pixels']=dict(size=[w,h],changed=sum(v>0 for v in differences),maximumChannelDifference=max(differences),meanMaximumDifference=sum(differences)/(w*h),equalPNG=ma['sha256']==mb['sha256'])
  result['edges']=[];result['brightness']=[]
  for level in edge_levels:
   pa=a['edges'][level];pb=b['edges'][level];da=describe(pa);db=describe(pb)
   valid=all(32<=d['area']<=w*h/3 and d['bbox'][2]-d['bbox'][0]>=16 and d['bbox'][3]-d['bbox'][1]>=16 for d in [da,db])
   if not valid:result['quality']='INCONCLUSIVE';result['qualityIssues'].append('edge-support-'+str(level))
   result['edges'].append(dict(level=level,left=da,right=db,iou=overlap(pa,pb)))
  for level in bright_levels:
   pa=a['bright'][level];pb=b['bright'][level];da=describe(pa);db=describe(pb)
   valid=all(d['bbox'] and d['area']<w*h/2 and d['bbox'][0]>=2 and d['bbox'][1]>=2 and d['bbox'][2]<=w-2 and d['bbox'][3]<=h-2 for d in [da,db])
   result['brightness'].append(dict(level=level,quality='VALID_PROXY' if valid else 'INCONCLUSIVE_SEGMENTATION',left=da,right=db,iou=overlap(pa,pb)))
  if result['quality']=='VALID':
   result['geometryScore']=statistics.median(1-e['iou'] for e in result['edges'])
   ad=distance_map(a);bd=distance_map(b)
   values=[bd[y*w+x] for x,y in a['edges'][32]]+[ad[y*w+x] for x,y in b['edges'][32]]
   result['edgeDistance']=dict(type='symmetric-nearest-edge-Manhattan',meanPixels=sum(values)/len(values),maximumPixels=max(values))
 results.append(result)
output=dict(schema='camera-metrics-v1',caseId=case['caseId'],split=case['split'],profile=case['profile'],view=case['view'],pairs=results)
target=directory/(case['caseId']+'.metrics.json');target.write_text(json.dumps(output,indent=2),encoding='utf-8');print(json.dumps(output))
`;

export async function calculateCameraMetrics(casePath) {
  const run = promisify(execFile);
  const { stdout } = await run(path.join(sourceRoot, '.venv', 'Scripts', 'python.exe'), ['-B', '-c', metricScript, casePath], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** Chỉ dùng positive/focus-normalized và intentional changes của tập train. */
export async function freezeCameraCalibration() {
  const directory = path.join(runDir, 'analysis');
  const names = (await fs.readdir(directory)).filter(name => /^metric-train-\d+\.metrics\.json$/.test(name)).sort();
  const cases = await Promise.all(names.map(name => fs.readFile(path.join(directory, name), 'utf8').then(JSON.parse)));
  const model = { schema: 'camera-calibration-v1', approved: false, status: 'INCONCLUSIVE', trainingCases: names, excludedFromFit: ['theme', 'focus-raw', 'default-restoration'], primaryScore: 'median(1-edgeIoU), levels 16/32/64', profile: { width: 1440, height: 1080, dpr: 1 }, themes: {} };
  for (const theme of ['dark', 'light']) {
    const pairs = cases.flatMap(item => item.pairs).filter(pair => pair.theme === theme);
    const stable = pairs.filter(pair => ['positive', 'focus-normalized'].includes(pair.kind));
    const changed = pairs.filter(pair => pair.kind.startsWith('negative-') || pair.kind === 'reset');
    const invalid = [...stable, ...changed].filter(pair => pair.quality !== 'VALID');
    if (cases.length !== 12 || !stable.length || !changed.length || invalid.length) {
      model.themes[theme] = { status: 'INCONCLUSIVE', reason: 'Thiếu tập train hoặc điều kiện đo/edge support không hợp lệ', invalid: invalid.map(p => p.name) };
      continue;
    }
    const upper = Math.max(...stable.map(pair => pair.geometryScore));
    const lower = Math.min(...changed.map(pair => pair.geometryScore));
    model.themes[theme] = { status: upper < lower ? 'SEPARATED' : 'INCONCLUSIVE', stableMaximum: upper, changeMinimum: lower, stableCount: stable.length, changeCount: changed.length, stableScores: stable.map(p => p.geometryScore), changeScores: changed.map(p => ({ kind: p.kind, score: p.geometryScore })), passThreshold: upper < lower ? upper + (lower - upper) / 3 : null, changeThreshold: upper < lower ? upper + 2 * (lower - upper) / 3 : null };
  }
  if (Object.values(model.themes).every(theme => theme.status === 'SEPARATED')) model.status = 'FROZEN_CANDIDATE_NOT_APPROVED';
  const body = JSON.stringify(model, null, 2);
  await fs.writeFile(path.join(directory, 'calibration-model.json'), body, { flag: 'wx' });
  return { status: model.status, sha256: createHash('sha256').update(body).digest('hex'), themes: model.themes };
}

export function evaluateCameraMetrics(metrics, model) {
  return metrics.pairs.filter(pair => pair.kind !== 'focus-raw').map(pair => {
    const bounds = model.themes[pair.theme];
    const classification = pair.quality !== 'VALID' || bounds?.status !== 'SEPARATED' ? 'INCONCLUSIVE' : pair.geometryScore <= bounds.passThreshold ? 'STABLE' : pair.geometryScore >= bounds.changeThreshold ? 'CHANGED' : 'INCONCLUSIVE';
    const expected = pair.kind.startsWith('negative-') || pair.kind === 'reset' ? 'CHANGED' : 'STABLE';
    return { name: pair.name, theme: pair.theme, kind: pair.kind, score: pair.geometryScore, expected, classification, status: classification === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : classification === expected ? 'PASS' : 'FAIL' };
  });
}

/** Lưu đúng PNG dùng tính hash; chỉ đọc canvas WebGL đang tồn tại. */
export async function captureCanvasDiagnostic(frame, name, identity) {
  const directory = path.join(runDir, 'analysis');
  await fs.mkdir(directory, { recursive: true });
  let previous;
  await expect.poll(async () => {
    const hash = await canvasHash(frame);
    const stable = hash === previous;
    previous = hash;
    return stable;
  }, { message: 'Hai lần đọc ảnh liên tiếp ổn định, không ép render runtime' }).toBe(true);
  const before = await canvasMetadata(frame, identity);
  const png = await frame.locator('canvas').screenshot({ type: 'png' });
  const after = await canvasMetadata(frame, identity);
  const metadata = { name, png: `${name}.png`, sha256: createHash('sha256').update(png).digest('hex'), before, after };
  await fs.writeFile(path.join(directory, `${name}.png`), png);
  await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(metadata, null, 2));
  return metadata;
}
