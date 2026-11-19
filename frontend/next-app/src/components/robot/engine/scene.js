import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createNova} from './model.js';
import {MotionController} from './motion.js';
import {AuthPose} from './auth-pose.ts';
import {BeastController} from './beast.js';

export function createStage(host,{onReaction,onInteract,onStats,onState,onRotation,onReady,onError,onFrame,embedded=false}={}){
 let renderer;const failedCleanup=[];try{
 renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
 renderer.info.autoReset=false;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.setClearColor(0x000000,0);
 renderer.domElement.setAttribute('tabindex','0');renderer.domElement.setAttribute('aria-label','Robot NOVA 3D. Enter để tương tác. Phím mũi tên để xoay.');host.append(renderer.domElement);
 const scene=new T.Scene();scene.background=null;const camera=new T.PerspectiveCamera(36,1,.1,45);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;controls.minDistance=5.2;controls.maxDistance=15;controls.minPolarAngle=.55;controls.maxPolarAngle=1.7;
 const nova=createNova();scene.add(nova.root);const controller=new MotionController();const authPose=new AuthPose();const beast=new BeastController(nova);failedCleanup.push(()=>nova.dispose());
 beast.autoIdle=!embedded;
 const environment=new RoomEnvironment();const pmrem=new T.PMREMGenerator(renderer);const envTarget=pmrem.fromScene(environment,.04);scene.environment=envTarget.texture;scene.environmentIntensity=.6;environment.dispose();pmrem.dispose();failedCleanup.push(()=>envTarget.dispose());
 const key=new T.DirectionalLight(0xffeee5,2.8);key.position.set(-1.2,7.5,6.5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-6,right:6,top:6.5,bottom:-6,near:.5,far:20});key.shadow.bias=-.0003;key.shadow.normalBias=.025;scene.add(key);
 const cyanRim=new T.DirectionalLight(0x65d9f4,2.6);cyanRim.position.set(-4,2,-3);scene.add(cyanRim);
 const pinkRim=new T.DirectionalLight(0xd8a2ed,3.7);pinkRim.position.set(4,4,-2);scene.add(pinkRim);
 const fill=new T.DirectionalLight(0xb6c5f4,1.1);fill.position.set(3,2,5);scene.add(fill,new T.HemisphereLight(0xc1daf6,0x302b38,.8));
 // Pedestal removed: only a transparent grounding shadow plane remains
 const floor=new T.Mesh(new T.CircleGeometry(5.5,48),new T.ShadowMaterial({opacity:.16}));floor.rotation.x=-Math.PI/2;floor.position.y=.04;floor.receiveShadow=true;scene.add(floor);
 // A single instanced draw for optional original celebration particles.
 const particleGeo=new T.OctahedronGeometry(.025,0),particleMat=new T.MeshBasicMaterial({color:0xb9eafa,toneMapped:false});
 const particles=new T.InstancedMesh(particleGeo,particleMat,30);particles.visible=false;scene.add(particles);const dummy=new T.Object3D();
 const particleSeeds=Array.from({length:30},(_,i)=>({angle:i*2.39996,speed:.5+(i%7)*.08,height:.8+(i%5)*.18}));for(let i=0;i<30;i++)particles.setColorAt(i,new T.Color([0x67ecff,0xc194ff,0xf291cc][i%3]));
 const renderPass=new RenderPass(scene,camera);renderPass.clearAlpha=0;
 const composer=new EffectComposer(renderer);composer.addPass(renderPass);const bloom=new UnrealBloomPass(new T.Vector2(1,1),.24,.22,1.38);
 Object.assign(bloom.blendMaterial,{blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.DstAlphaFactor,blendDst:T.OneFactor,blendSrcAlpha:T.ZeroFactor,blendDstAlpha:T.OneFactor});
 composer.addPass(bloom);const output=new OutputPass();composer.addPass(output);failedCleanup.push(()=>{for(const pass of composer.passes)pass.dispose?.();composer.dispose();});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2(),camOffset=new T.Vector3();let pointerDown=null,disposed=false,inView=false,loopActive=false,loopCallbacks=0,pointerRect=host.getBoundingClientRect(),lastFrame=performance.now(),lastStats=lastFrame,frames=0,angle=0,quality='auto',high=true,renderedFrames=0,stats={},lookX=0,lookY=0,dirty=true,lastSignature='',frameBudget=0,poseDelta=0,lastBeastProgress=0,lastFramingDistance=7.5,lastFramingTargetY=2.06;
 // Embedded UI shares the main thread with input/theme work. Retain full model,
 // lighting, DPR and animation, but don't submit 144+ WebGL frames per second.
 const frameInterval=embedded?1000/60:0;
 const media=matchMedia('(prefers-reduced-motion: reduce)');controller.reduced=media.matches;
 const abort=new AbortController(),signal=abort.signal;failedCleanup.push(()=>abort.abort(),()=>controls.dispose());
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'';const software=/swiftshader|llvmpipe|software|basic render/i.test(gpu);
 function computeCameraFraming(w,h,p){
  const aspect=Math.max(.45,w/Math.max(1,h));
  const mobile=w<600;
  const desktopHero=embedded&&w>=680;
  const offsetXFrac=embedded?(desktopHero?-.105:0):(w>600?-.1:0);
  const offsetYFrac=embedded?0:(w>600?-.06:0);
  const envW=T.MathUtils.lerp(2.4,5.68,p);
  const envH=T.MathUtils.lerp(4.45,5.42,p);
  const targetY=T.MathUtils.lerp(embedded?2.06:1.98,2.58,p);
  const depthPad=T.MathUtils.lerp(embedded?.72:.85,1.06,p);
  const tanHalfFov=Math.tan(T.MathUtils.degToRad(camera.fov*.5));
  const usableX=Math.max(.55,1-2*Math.abs(offsetXFrac));
  const usableY=Math.max(.55,1-2*Math.abs(offsetYFrac));
  const distV=(envH*.5)/(tanHalfFov*usableY);
  const distH=(envW*.5)/(tanHalfFov*aspect*usableX);
  const baseMin=embedded?(mobile?7.2:7.05):(mobile?9.2:7.8);
  const distance=Math.max(baseMin,Math.max(distV,distH)+depthPad);
  const camX=embedded?1.75:mobile?2.5:3.5;
  const camY=targetY+(embedded?.6:.75);
  return {aspect,offsetXFrac,offsetYFrac,targetY,distance,camX,camY};
 }
 function syncCameraFraming(p,forceResize=false){
  const dp=p-lastBeastProgress;
  if(!forceResize&&Math.abs(dp)<1e-5)return;
  lastBeastProgress=p;
  const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
  const f=computeCameraFraming(w,h,p);
  const dTargetY=f.targetY-lastFramingTargetY;
  const dDist=f.distance-lastFramingDistance;
  lastFramingTargetY=f.targetY;
  lastFramingDistance=f.distance;
  controls.target.y+=dTargetY;
  camera.position.y+=dTargetY;
  camOffset.subVectors(camera.position,controls.target);
  const len=camOffset.length();
  if(len>.001){
   camOffset.normalize().multiplyScalar(T.MathUtils.clamp(len+dDist,controls.minDistance,controls.maxDistance));
   camera.position.copy(controls.target).add(camOffset);
  }
 }
 function updateQuality(){high=quality==='high'||quality==='auto'&&host.clientWidth>650&&!software;renderer.setPixelRatio(Math.min(devicePixelRatio,high?1.25:1));renderer.shadowMap.enabled=high;resize();}
 function home(){const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight),p=beast.progress,f=computeCameraFraming(w,h,p);lastBeastProgress=p;lastFramingDistance=f.distance;lastFramingTargetY=f.targetY;const dy=f.camY-f.targetY,camZ=Math.sqrt(Math.max(1,f.distance*f.distance-f.camX*f.camX-dy*dy));camera.position.set(f.camX,f.camY,camZ);controls.target.set(0,f.targetY,0);controls.update();controls.saveState();resize();}
 function resize(){dirty=true;pointerRect=host.getBoundingClientRect();const w=host.clientWidth,h=host.clientHeight;if(w<1||h<1)return;const f=computeCameraFraming(w,h,beast.progress);camera.aspect=w/h;camera.setViewOffset(w,h,w*f.offsetXFrac,h*f.offsetYFrac,w,h);camera.updateProjectionMatrix();syncCameraFraming(beast.progress,true);renderer.setSize(w,h,false);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);}
 controls.addEventListener('change',()=>{dirty=true;});
 let narrow=host.clientWidth<600;const resizeObserver=new ResizeObserver(()=>{if(narrow!==(host.clientWidth<600)){narrow=host.clientWidth<600;home();updateQuality();}else resize();});resizeObserver.observe(host);failedCleanup.push(()=>resizeObserver.disconnect());
 function syncLoop(){const active=!disposed&&inView&&!document.hidden;if(active===loopActive)return;loopActive=active;lastFrame=performance.now();lastStats=lastFrame;frames=0;frameBudget=0;poseDelta=0;renderer.setAnimationLoop(active?render:null);}
 const intersection=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??false;syncLoop();});intersection.observe(host);failedCleanup.push(()=>intersection.disconnect());
 document.addEventListener('visibilitychange',syncLoop,{signal});
 window.addEventListener('scroll',()=>{if(inView)pointerRect=host.getBoundingClientRect();},{passive:true,capture:true,signal});
 const onMedia=()=>{controller.reduced=media.matches;controller.reset();beast.reset();dirty=true;};media.addEventListener('change',onMedia);failedCleanup.push(()=>media.removeEventListener('change',onMedia));
 (embedded?window:host).addEventListener('pointermove',event=>{if(!inView||document.hidden||!controller.tracking)return;const r=pointerRect;controller.pointer.x=T.MathUtils.clamp(((event.clientX-r.left)/r.width-.5)*2,-1,1);controller.pointer.y=T.MathUtils.clamp(-((event.clientY-r.top)/r.height-.5)*2,-1,1);},{signal});
 if(embedded){
  const userInteract=()=>{beast.interrupt();onInteract?.();dirty=true;};
  window.addEventListener('pointerdown',userInteract,{passive:true,capture:true,signal});
  window.addEventListener('keydown',userInteract,{passive:true,capture:true,signal});
 }
 host.addEventListener('pointerleave',()=>{controller.pointer.x=0;controller.pointer.y=0;},{signal});
 renderer.domElement.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY};if(beast.progress>0||beast.idleSeconds>0){beast.interrupt();onInteract?.();dirty=true;}},{signal});
 renderer.domElement.addEventListener('pointerup',e=>{if(!pointerDown||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>6)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);if(raycaster.intersectObjects(nova.pickables,false).length){beast.interrupt();onReaction?.();}pointerDown=null;},{signal});
 renderer.domElement.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();beast.interrupt();onReaction?.();}if(e.key==='Home'){e.preventDefault();stage.reset();}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();beast.interrupt();onInteract?.();angle+=e.key==='ArrowLeft'?-.1:.1;onRotation?.(T.MathUtils.radToDeg(angle));}},{signal});
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();stats.contextLost=true;onState?.('CONTEXT LOST');},{signal});
 function applyPose(pose,dt){nova.root.position.set(0,pose.rootY,pose.rootZ);nova.root.rotation.y=angle;
  for(const name of ['torso','head','rightShoulder','leftShoulder','rightElbow','leftElbow','rightWrist','leftWrist','rightHip','leftHip','rightKnee','leftKnee']){const j=nova.joints[name],rest=nova.rest.get(name);j.rotation.set(rest.rotation.x+(pose[name+'X']||0),rest.rotation.y+(pose[name+'Y']||0),rest.rotation.z+(pose[name+'Z']||0));}
  const emotion=controller.emotion;let height=1,width=1,eyeTilt=0,color=0x9af6ff,mouthScale=1;switch(emotion){case'sad':height=.55;eyeTilt=-.14;mouthScale=-.5;break;case'worried':height=.75;eyeTilt=.2;color=0xc7bcf1;break;case'happy':height=.42;width=1.15;eyeTilt=.12;break;case'love':height=.82;width=1.15;color=0xff97d4;break;case'focused':height=.63;eyeTilt=-.2;color=0xb4b0ff;break;case'sleepy':height=.18;color=0xaaa4db;mouthScale=.5;break;case'surprised':height=1.18;width=1.12;break;}
  if(controller.action==='react'){height=1.2;width=1.12;}
  const blink=controller.blink*(1-.96*authPose.privacy);const factor=authPose.state==='privacy'&&controller.paused?1:controller.paused?0:controller.reduced?1:1-Math.exp(-dt*16);
  nova.eyes.forEach((eye,i)=>{eye.scale.y=T.MathUtils.lerp(eye.scale.y,height*blink,factor);eye.scale.x=T.MathUtils.lerp(eye.scale.x,width,factor);eye.rotation.z=T.MathUtils.lerp(eye.rotation.z,(i?1:-1)*eyeTilt,factor);});
  const blend=controller.reduced?1:1-Math.exp(-dt*10);if(!controller.paused){lookX=T.MathUtils.lerp(lookX,controller.reduced||!controller.tracking?0:controller.pointer.x*.07,blend);lookY=T.MathUtils.lerp(lookY,controller.reduced||!controller.tracking?0:controller.pointer.y*.045,blend);}
  nova.joints.face.position.x=lookX;nova.joints.face.position.y=.05+lookY;nova.eyeMat.color.setHex(color);nova.smile.scale.y=mouthScale;nova.smile.visible=emotion!=='surprised'&&controller.action!=='react';nova.oMouth.visible=!nova.smile.visible;
  const beastBrow=beast.progress*.18;
  nova.joints.leftBrow.rotation.z=T.MathUtils.lerp(nova.joints.leftBrow.rotation.z,emotion==='focused'?-.25:beast.progress>.2?-beastBrow:emotion==='curious'?.12:0,blend);
  nova.joints.rightBrow.rotation.z=T.MathUtils.lerp(nova.joints.rightBrow.rotation.z,emotion==='focused'?.25:beast.progress>.2?beastBrow:0,blend);
  const showParticles=controller.action==='celebrate'&&!controller.reduced;particles.visible=showParticles;if(showParticles){const progress=controller.actionTime;for(let i=0;i<30;i++){const seed=particleSeeds[i],t=(progress*.8+i*.033)%1;dummy.position.set(Math.cos(seed.angle)*t*2.5,1.3+seed.height+Math.sin(t*Math.PI)*1.4-t,Math.sin(seed.angle)*t*2);dummy.rotation.set(progress+i,progress*2,seed.angle);dummy.scale.setScalar(Math.sin(t*Math.PI));dummy.updateMatrix();particles.setMatrixAt(i,dummy.matrix);}particles.instanceMatrix.needsUpdate=true;}
 }
 let lastAction='idle';
 function renderFrame(now){if(disposed)return;const elapsed=Math.max(0,now-lastFrame),tickDelta=Math.min(elapsed/1000,.05);lastFrame=now;if(document.hidden||!inView)return;onFrame?.(controller.paused?0:tickDelta);frameBudget+=elapsed;poseDelta+=tickDelta;if(frameInterval&&!dirty&&frameBudget+.1<frameInterval)return;const dt=Math.min(poseDelta,.05);poseDelta=0;if(frameInterval)frameBudget%=frameInterval;
  const base=controller.update(dt);
  const authApplied=authPose.update(base,controller.paused?0:dt,controller.reduced||controller.paused);
  const canIdle=authPose.state==='idle'&&controller.action==='idle'&&!controller.paused&&!controller.reduced;
  const pose=beast.update(authApplied,controller.paused?0:dt,{canIdle,reduced:controller.reduced,paused:controller.paused});
  syncCameraFraming(beast.progress,false);
  controls.update();
  const signature=[controller.action,controller.emotion,controller.paused,controller.reduced,controller.blinkTime>=0,authPose.state,beast.state,Math.round(beast.progress*1000),angle,quality].join(',');if(signature!==lastSignature){dirty=true;lastSignature=signature;}if((controller.paused||controller.reduced)&&!dirty)return;dirty=false;
  applyPose(pose,dt);if(controller.action!==lastAction){lastAction=controller.action;onState?.(lastAction.toUpperCase());}
  renderer.info.reset();if(high)composer.render(dt);else renderer.render(scene,camera);renderedFrames++;if(renderedFrames===1)onReady?.();frames++;if(now-lastStats>1000){stats={fps:Math.round(frames*1000/(now-lastStats)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,pixelRatio:renderer.getPixelRatio(),quality:high?'high':'lite',frames:renderedFrames};onStats?.(stats);frames=0;lastStats=now;}}
 function render(now){loopCallbacks++;try{renderFrame(now);}catch(error){stage.dispose();onError?.(error);}}
 home();updateQuality();
 const stage={controller,beast,nova,renderer,setInteraction(mode){authPose.setMode(mode);if(mode!=='idle')beast.interrupt();controls.enabled=mode!=='privacy';dirty=true;},setBeast(active){if(controller.reduced)return;beast.setActive(active);dirty=true;},setTheme(light){scene.background=null;scene.environmentIntensity=light?.65:.6;dirty=true;},trigger(action){if(action!=='idle')beast.interrupt();controller.trigger(action);dirty=true;onState?.(controller.action.toUpperCase());},setAngle(degrees){angle=T.MathUtils.degToRad(degrees);dirty=true;},setQuality(value){quality=value;updateQuality();},home,front(){const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight),p=beast.progress,f=computeCameraFraming(w,h,p);lastBeastProgress=p;lastFramingDistance=f.distance;lastFramingTargetY=f.targetY;camera.position.set(0,f.camY,f.distance);controls.target.set(0,f.targetY,0);controls.update();dirty=true;},reset(){controller.reset();beast.reset();lastBeastProgress=0;angle=0;home();dirty=true;onRotation?.(0);onState?.('IDLE');},snapshot(){scene.updateMatrixWorld(true);const point=new T.Vector3();nova.joints.head.getWorldPosition(point);point.project(camera);const pts=[nova.joints.head.localToWorld(new T.Vector3(0,.96,0)),nova.joints.head.localToWorld(new T.Vector3(0,.64,.42)),nova.joints.leftElbow.localToWorld(new T.Vector3(-.28,-.52,0)),nova.joints.rightElbow.localToWorld(new T.Vector3(.28,-.52,0)),nova.joints.leftWrist.localToWorld(new T.Vector3(-.22,-.42,.2)),nova.joints.rightWrist.localToWorld(new T.Vector3(.22,-.42,.2)),nova.root.localToWorld(new T.Vector3(0,.04,.22))];let ndcMinX=1,ndcMaxX=-1,ndcMinY=1,ndcMaxY=-1;for(const sp of pts){sp.project(camera);ndcMinX=Math.min(ndcMinX,sp.x);ndcMaxX=Math.max(ndcMaxX,sp.x);ndcMinY=Math.min(ndcMinY,sp.y);ndcMaxY=Math.max(ndcMaxY,sp.y);}const cw=host.clientWidth,ch=host.clientHeight,bounds={ndcMinX,ndcMaxX,ndcMinY,ndcMaxY,leftPx:(ndcMinX+1)*.5*cw,rightPx:(ndcMaxX+1)*.5*cw,topPx:(1-ndcMaxY)*.5*ch,bottomPx:(1-ndcMinY)*.5*ch,widthPx:(ndcMaxX-ndcMinX)*.5*cw,heightPx:(ndcMaxY-ndcMinY)*.5*ch,clipped:ndcMinX<-.98||ndcMaxX>.98||ndcMinY<-.98||ndcMaxY>.98};return {loopActive,loopCallbacks,inView,interaction:{mode:authPose.state,privacy:authPose.privacy},beast:beast.snapshot(),bounds,camera:camera.position.toArray(),distance:camera.position.distanceTo(controls.target),disposed,action:controller.action,paused:controller.paused,reduced:controller.reduced,time:controller.time,pose:{...controller.current},head:nova.joints.head.rotation.toArray(),eye:nova.eyes[0].scale.toArray(),hitPoint:{x:(point.x+1)/2*cw,y:(1-point.y)/2*ch},memory:{...renderer.info.memory},softwareGPU:software,stats:{...stats},frames:renderedFrames};},dispose(){if(disposed)return;disposed=true;loopActive=false;renderer.setAnimationLoop(null);abort.abort();media.removeEventListener('change',onMedia);resizeObserver.disconnect();intersection.disconnect();controls.dispose();nova.dispose();const geos=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();});key.shadow.dispose();geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());for(const pass of composer.passes)pass.dispose?.();composer.dispose();envTarget.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();}};
 syncLoop();return stage;
 }catch(error){for(const cleanup of failedCleanup.reverse()){try{cleanup();}catch{}}renderer?.setAnimationLoop(null);renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();throw error;}
}
