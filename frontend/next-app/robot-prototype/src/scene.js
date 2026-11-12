import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createNova} from './model.js';
import {MotionController} from './motion.js';

export function createStage(host,{onReaction,onStats,onState,onRotation}={}){
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
 renderer.info.autoReset=false;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.domElement.setAttribute('tabindex','0');renderer.domElement.setAttribute('aria-label','Robot NOVA 3D. Enter để tương tác. Phím mũi tên để xoay.');host.append(renderer.domElement);
 const scene=new T.Scene();scene.background=new T.Color(0x14151c);const camera=new T.PerspectiveCamera(36,1,.1,40);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;controls.minDistance=5.8;controls.maxDistance=12;controls.minPolarAngle=.65;controls.maxPolarAngle=1.65;
 const nova=createNova();scene.add(nova.root);const controller=new MotionController();
 const environment=new RoomEnvironment();const pmrem=new T.PMREMGenerator(renderer);const envTarget=pmrem.fromScene(environment,.045);scene.environment=envTarget.texture;scene.environmentIntensity=.6;environment.dispose();pmrem.dispose();
 const key=new T.DirectionalLight(0xffeee5,2.8);key.position.set(-3,6,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-3,right:3,top:5,bottom:-2,near:.5,far:15});key.shadow.bias=-.0003;key.shadow.normalBias=.025;scene.add(key);
 const cyanRim=new T.DirectionalLight(0x65d9f4,2.6);cyanRim.position.set(-4,2,-3);scene.add(cyanRim);
 const pinkRim=new T.DirectionalLight(0xd8a2ed,3.7);pinkRim.position.set(4,4,-2);scene.add(pinkRim);
 const fill=new T.DirectionalLight(0xb6c5f4,1.1);fill.position.set(3,2,5);scene.add(fill,new T.HemisphereLight(0xc1daf6,0x302b38,.8));
 const stageMaterial=new T.MeshStandardMaterial({color:0x252733,metalness:.66,roughness:.36});
 const platform=new T.Mesh(new T.CylinderGeometry(1.38,1.44,.13,80),stageMaterial);platform.position.y=-.035;platform.receiveShadow=true;scene.add(platform);
 const ringMaterial=new T.MeshBasicMaterial({color:0x5c97a8,toneMapped:false});const ring=new T.Mesh(new T.TorusGeometry(1.385,.007,6,100),ringMaterial);ring.rotation.x=-Math.PI/2;ring.position.y=.034;scene.add(ring);
 const tickGeo=new T.BoxGeometry(.013,.003,.065),tickMat=new T.MeshBasicMaterial({color:0x717282}),ticks=new T.InstancedMesh(tickGeo,tickMat,48),tickTransform=new T.Object3D();
 for(let i=0;i<48;i++){const angle=i/48*Math.PI*2;tickTransform.position.set(Math.sin(angle)*1.31,.034,Math.cos(angle)*1.31);tickTransform.rotation.y=angle;tickTransform.updateMatrix();ticks.setMatrixAt(i,tickTransform.matrix);}scene.add(ticks);
 const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.ShadowMaterial({opacity:.3}));floor.rotation.x=-Math.PI/2;floor.position.y=-.105;floor.receiveShadow=true;scene.add(floor);
 // A single instanced draw for optional original celebration particles.
 const particleGeo=new T.OctahedronGeometry(.025,0),particleMat=new T.MeshBasicMaterial({color:0xb9eafa,toneMapped:false});
 const particles=new T.InstancedMesh(particleGeo,particleMat,30);particles.visible=false;scene.add(particles);const dummy=new T.Object3D();
 const particleSeeds=Array.from({length:30},(_,i)=>({angle:i*2.39996,speed:.5+(i%7)*.08,height:.8+(i%5)*.18}));for(let i=0;i<30;i++)particles.setColorAt(i,new T.Color([0x67ecff,0xc194ff,0xf291cc][i%3]));
 const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const bloom=new UnrealBloomPass(new T.Vector2(1,1),.3,.35,1.25);composer.addPass(bloom);const output=new OutputPass();composer.addPass(output);
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let pointerDown=null,disposed=false,inView=true,lastFrame=performance.now(),lastStats=lastFrame,frames=0,angle=0,quality='auto',high=true,renderedFrames=0,stats={},lookX=0,lookY=0,dirty=true,lastSignature='';
 const media=matchMedia('(prefers-reduced-motion: reduce)');controller.reduced=media.matches;
 const abort=new AbortController(),signal=abort.signal;
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'';const software=/swiftshader|llvmpipe|software|basic render/i.test(gpu);
 function updateQuality(){high=quality==='high'||quality==='auto'&&host.clientWidth>650&&!software;renderer.setPixelRatio(Math.min(devicePixelRatio,high?1.25:1));renderer.shadowMap.enabled=high;resize();}
 function home(){const mobile=host.clientWidth<600;camera.position.set(mobile?2.8:4.2,mobile?2.7:3.4,mobile?10.8:8.8);controls.target.set(0,1.9,0);controls.update();controls.saveState();resize();}
 function resize(){dirty=true;const w=host.clientWidth,h=host.clientHeight;if(w<1||h<1)return;camera.aspect=w/h;camera.setViewOffset(w,h,w>600?-w*.12:0,w>600?0:-h*.1,w,h);camera.updateProjectionMatrix();renderer.setSize(w,h,false);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);}
 controls.addEventListener('change',()=>{dirty=true;});
 let narrow=host.clientWidth<600;const resizeObserver=new ResizeObserver(()=>{if(narrow!==(host.clientWidth<600)){narrow=host.clientWidth<600;home();updateQuality();}else resize();});resizeObserver.observe(host);
 const intersection=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??false;lastFrame=performance.now();});intersection.observe(host);
 const onMedia=()=>{controller.reduced=media.matches;controller.reset();};media.addEventListener('change',onMedia);
 host.addEventListener('pointermove',event=>{const r=host.getBoundingClientRect();controller.pointer.x=((event.clientX-r.left)/r.width-.5)*2;controller.pointer.y=-((event.clientY-r.top)/r.height-.5)*2;},{signal});
 host.addEventListener('pointerleave',()=>{controller.pointer.x=0;controller.pointer.y=0;},{signal});
 renderer.domElement.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY};},{signal});
 renderer.domElement.addEventListener('pointerup',e=>{if(!pointerDown||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>6)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);if(raycaster.intersectObjects(nova.pickables,false).length)onReaction?.();pointerDown=null;},{signal});
 renderer.domElement.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onReaction?.();}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();angle+=e.key==='ArrowLeft'?-.1:.1;onRotation?.(T.MathUtils.radToDeg(angle));}},{signal});
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();stats.contextLost=true;onState?.('CONTEXT LOST');},{signal});
 function applyPose(pose,dt){nova.root.position.set(0,pose.rootY,pose.rootZ);nova.root.rotation.y=angle;
  for(const name of ['torso','head','rightShoulder','leftShoulder','rightElbow','leftElbow','rightWrist','leftWrist','rightHip','leftHip','rightKnee','leftKnee']){const j=nova.joints[name],rest=nova.rest.get(name);j.rotation.set(rest.rotation.x+(pose[name+'X']||0),rest.rotation.y+(pose[name+'Y']||0),rest.rotation.z+(pose[name+'Z']||0));}
  const emotion=controller.emotion;let height=1,width=1,eyeTilt=0,color=0x9af6ff,mouthScale=1;switch(emotion){case'happy':height=.42;width=1.15;eyeTilt=.12;break;case'love':height=.82;width=1.15;color=0xff97d4;break;case'focused':height=.63;eyeTilt=-.2;color=0xb4b0ff;break;case'sleepy':height=.18;color=0xaaa4db;mouthScale=.5;break;case'surprised':height=1.18;width=1.12;break;}
  if(controller.action==='react'){height=1.2;width=1.12;}
  const blink=controller.blink;const factor=controller.paused?0:controller.reduced?1:1-Math.exp(-dt*16);
  nova.eyes.forEach((eye,i)=>{eye.scale.y=T.MathUtils.lerp(eye.scale.y,height*blink,factor);eye.scale.x=T.MathUtils.lerp(eye.scale.x,width,factor);eye.rotation.z=T.MathUtils.lerp(eye.rotation.z,(i?1:-1)*eyeTilt,factor);});
  const blend=controller.reduced?1:1-Math.exp(-dt*10);if(!controller.paused){lookX=T.MathUtils.lerp(lookX,controller.reduced||!controller.tracking?0:controller.pointer.x*.07,blend);lookY=T.MathUtils.lerp(lookY,controller.reduced||!controller.tracking?0:controller.pointer.y*.045,blend);}
  nova.joints.face.position.x=lookX;nova.joints.face.position.y=.05+lookY;nova.eyeMat.color.setHex(color);nova.smile.scale.y=mouthScale;nova.smile.visible=emotion!=='surprised'&&controller.action!=='react';nova.oMouth.visible=!nova.smile.visible;
  nova.joints.leftBrow.rotation.z=T.MathUtils.lerp(nova.joints.leftBrow.rotation.z,emotion==='focused'?-.25:emotion==='curious'?.12:0,blend);nova.joints.rightBrow.rotation.z=T.MathUtils.lerp(nova.joints.rightBrow.rotation.z,emotion==='focused'?.25:0,blend);
  const showParticles=controller.action==='celebrate'&&!controller.reduced;particles.visible=showParticles;if(showParticles){const progress=controller.actionTime;for(let i=0;i<30;i++){const seed=particleSeeds[i],t=(progress*.8+i*.033)%1;dummy.position.set(Math.cos(seed.angle)*t*2.5,1.3+seed.height+Math.sin(t*Math.PI)*1.4-t,Math.sin(seed.angle)*t*2);dummy.rotation.set(progress+i,progress*2,seed.angle);dummy.scale.setScalar(Math.sin(t*Math.PI));dummy.updateMatrix();particles.setMatrixAt(i,dummy.matrix);}particles.instanceMatrix.needsUpdate=true;}
 }
 let lastAction='idle';
 function render(now){if(disposed)return;const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;if(document.hidden||!inView)return;controls.update();const signature=[controller.action,controller.emotion,controller.paused,controller.reduced,controller.blinkTime>=0,angle,quality].join(',');if(signature!==lastSignature){dirty=true;lastSignature=signature;}if((controller.paused||controller.reduced)&&!dirty)return;dirty=false;const pose=controller.update(dt);applyPose(pose,dt);if(controller.action!==lastAction){lastAction=controller.action;onState?.(lastAction.toUpperCase());}
  renderer.info.reset();if(high)composer.render(dt);else renderer.render(scene,camera);renderedFrames++;frames++;if(now-lastStats>1000){stats={fps:Math.round(frames*1000/(now-lastStats)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,pixelRatio:renderer.getPixelRatio(),quality:high?'high':'lite',frames:renderedFrames};onStats?.(stats);frames=0;lastStats=now;}}
 home();updateQuality();renderer.setAnimationLoop(render);
 return {controller,nova,renderer,trigger(action){controller.trigger(action);dirty=true;onState?.(controller.action.toUpperCase());},setAngle(degrees){angle=T.MathUtils.degToRad(degrees);},setQuality(value){quality=value;updateQuality();},home,front(){camera.position.set(0,2.7,9.5);controls.target.set(0,1.9,0);controls.update();dirty=true;},reset(){controller.reset();angle=0;home();dirty=true;onRotation?.(0);onState?.('IDLE');},snapshot(){const point=new T.Vector3();nova.joints.head.getWorldPosition(point);point.project(camera);return {disposed,action:controller.action,paused:controller.paused,reduced:controller.reduced,time:controller.time,pose:{...controller.current},head:nova.joints.head.rotation.toArray(),eye:nova.eyes[0].scale.toArray(),hitPoint:{x:(point.x+1)/2*host.clientWidth,y:(1-point.y)/2*host.clientHeight},memory:{...renderer.info.memory},softwareGPU:software,stats:{...stats},frames:renderedFrames};},dispose(){if(disposed)return;disposed=true;renderer.setAnimationLoop(null);abort.abort();media.removeEventListener('change',onMedia);resizeObserver.disconnect();intersection.disconnect();controls.dispose();nova.dispose();const geos=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();});key.shadow.dispose();geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());for(const pass of composer.passes)pass.dispose?.();composer.dispose();envTarget.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();}}
}
