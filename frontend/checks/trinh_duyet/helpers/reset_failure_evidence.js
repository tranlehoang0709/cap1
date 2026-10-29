/** Chỉ lưu PNG đã dùng trong assertion; tuyệt đối không chụp/render lại khi FAIL. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runDir,sourceRoot} from './moi_truong.js';

const captures=new WeakMap();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function rememberCanvasCapture(frame,png,sha256){
  captures.set(frame,Object.freeze({png,sha256,capturedAt:new Date().toISOString()}));
}
export function latestCanvasCapture(frame){return captures.get(frame);}

const pixelAnalysis=String.raw`
import sys,json
from pathlib import Path
from PIL import Image,ImageChops,ImageEnhance
root=Path(sys.argv[1]);a=Image.open(root/'expected.png');b=Image.open(root/'actual.png')
metadata=dict(expected=dict(size=a.size,mode=a.mode,format=a.format),actual=dict(size=b.size,mode=b.mode,format=b.format))
if a.size!=b.size:
 metadata.update(status='DIMENSION_MISMATCH',differentPixels=None,bbox=None)
else:
 a=a.convert('RGBA');b=b.convert('RGBA');pa=a.load();pb=b.load();points=[];maximum=[0,0,0,0]
 mask=Image.new('RGB',a.size);mp=mask.load()
 for y in range(a.height):
  for x in range(a.width):
   d=[abs(p-q)for p,q in zip(pa[x,y],pb[x,y])]
   maximum=[max(p,q)for p,q in zip(maximum,d)]
   if any(d):points.append((x,y));mp[x,y]=(255,40,120)
 diff=ImageChops.difference(a.convert('RGB'),b.convert('RGB'))
 ImageEnhance.Brightness(diff).enhance(32).save(root/'difference-x32.png');mask.save(root/'difference-regions.png')
 bbox=[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points)+1,max(y for x,y in points)+1] if points else None
 metadata.update(status='MEASURED',differentPixels=len(points),bbox=bbox,maxChannelDifference=maximum,visualizationGain=32)
(root/'pixel-difference.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
`;

async function observe(frame){
  if(!frame)return {availability:'NOT_AVAILABLE',reason:'No live frame supplied'};
  return frame.evaluate(()=>{
    const canvas=document.querySelector('canvas'),d=window.__AIVA3D__;
    return {observedAt:new Date().toISOString(),timing:'AFTER original assertion failure; not capture-time state',
      viewport:{width:innerWidth,height:innerHeight,parentWidth:parent.innerWidth,parentHeight:parent.innerHeight,dpr:devicePixelRatio},
      theme:d?.theme,focus:{tag:document.activeElement?.tagName,id:document.activeElement?.id||null,canvasFocused:document.activeElement===canvas,focusVisible:canvas?.matches(':focus-visible')},
      canvas:canvas?{width:canvas.width,height:canvas.height,rect:canvas.getBoundingClientRect().toJSON()}:null,
      diagnostics:d?{...d}:null,expressionId:document.getElementById('expression')?.value,
      pausePressed:document.getElementById('pause')?.getAttribute('aria-pressed'),status:document.getElementById('status')?.textContent,
      cameraControls:{availability:'NOT_OBSERVABLE',reason:'Private closure; no state injection, debugger pause or render after failure'},
      pixelAnimationState:{availability:'NOT_OBSERVABLE',reason:'Private controller; selected ID and frame diagnostics only'}};
  });
}

async function provenance(){
  const {cameraChecksums}=await import('./ho_so_camera.js');
  const result={checksums:await cameraChecksums()};
  result.diagnosticChecksums={};
  for(const file of ['helpers/reset_failure_evidence.js','helpers/reset_failure_evidence.test.js','specs/reset_evidence.spec.js']){
    result.diagnosticChecksums[file]=sha(await fs.readFile(path.join(sourceRoot,'checks/trinh_duyet',file)));
  }
  const file=process.env.AIVA_MAIN_SERVER_ATTESTATION;
  if(file){
    const bytes=await fs.readFile(file);
    result.attestation={path:file,sha256:sha(bytes),expectedSHA256:process.env.AIVA_MAIN_SERVER_ATTESTATION_SHA256,evidence:JSON.parse(bytes)};
    if(result.attestation.sha256!==result.attestation.expectedSHA256)throw Error('Attestation SHA mismatch');
  }else result.attestation={availability:'NOT_CONFIGURED'};
  return result;
}

export async function collectResetFailure({expected,actual,error,frame,root=path.join(runDir,'reset-failures'),imageSource='Cached original Reset assertion buffers',observeState,collectProvenance}={}){
  const relative=path.relative(sourceRoot,path.resolve(root));
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw Error('Evidence must be outside production source');
  if(!expected?.png||!actual?.png)throw Error('Original assertion PNG buffers unavailable; no replacement screenshot allowed');
  const expectedPNG=Buffer.from(expected.png),actualPNG=Buffer.from(actual.png);
  if(sha(expectedPNG)!==expected.sha256||sha(actualPNG)!==actual.sha256)throw Error('Cached original PNG checksum mismatch');
  const directory=path.join(root,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'expected.png'),expectedPNG,{flag:'wx'});
  await fs.writeFile(path.join(directory,'actual.png'),actualPNG,{flag:'wx'});
  const report={imageSource,originalFailure:{name:error?.name,message:error?.message},
    expected:{sha256:expected.sha256,capturedAt:expected.capturedAt},actual:{sha256:actual.sha256,capturedAt:actual.capturedAt},
    capturePolicy:'No retry, screenshot substitution, camera mutation or rendering in collector',
    actualSemantics:'Last PNG captured by original polling; if callback threw, this is a sample, not a returned comparison value',collectionErrors:[]};
  try{report.observation=await(observeState?observeState():observe(frame));}catch(e){report.collectionErrors.push({phase:'observation',message:e.message});}
  try{report.provenance=await(collectProvenance?collectProvenance():provenance());}catch(e){report.collectionErrors.push({phase:'provenance',message:e.message});}
  try{await promisify(execFile)(path.join(sourceRoot,'.venv/Scripts/python.exe'),['-B','-c',pixelAnalysis,directory],{timeout:30000,windowsHide:true});}catch(e){report.collectionErrors.push({phase:'pixel-analysis',message:e.message});}
  report.inputsUnchanged=sha(expected.png)===expected.sha256&&sha(actual.png)===actual.sha256;
  await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(report,null,2),{flag:'wx'});
  return {directory,report};
}
