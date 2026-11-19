import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNova} from '../src/components/robot/engine/model.js';
import {MotionController} from '../src/components/robot/engine/motion.js';
import {BeastController} from '../src/components/robot/engine/beast.js';

test('integrated NOVA preserves approved model, motion and synthesized audio verbatim',()=>{
 for(const file of ['model.js','motion.js','audio.js'])
  assert.equal(readFileSync(`src/components/robot/engine/${file}`,'utf8'),readFileSync(`robot-prototype/src/${file}`,'utf8'));
});

test('integrated rigid hierarchy and interruption/pause retain prototype behavior',()=>{
 const nova=createNova();
 for(const name of ['head','torso','leftShoulder','rightShoulder','leftElbow','rightElbow','leftHip','rightHip','leftKnee','rightKnee'])
  assert.ok(nova.root.getObjectByName(name));
 const motion=new MotionController();
 motion.trigger('wave');
 for(let i=0;i<40;i++)motion.update(1/60);
 motion.trigger('dance');
 motion.update(1/60);
 assert.ok(Object.values(motion.current).every(Number.isFinite));
 motion.paused=true;
 const pose={...motion.current};
 motion.update(1);
 assert.deepEqual(motion.current,pose);
 nova.dispose();
 assert.equal(nova.root.children.length,0);
});

test('BeastController transforms after 5s idle into double-biceps pose with unchanged head scale and reversible mid-morph interrupt',()=>{
 const nova=createNova();
 const motion=new MotionController();
 const beast=new BeastController(nova);

 // Initially normal NOVA
 assert.equal(beast.state,'normal');
 assert.equal(beast.progress,0);
 assert.equal(nova.root.getObjectByName('beastTorso')?.visible,false);
 const normalSpan=beast.snapshot().shoulderSpan;
 assert.ok(Math.abs(normalSpan-1.32)<0.01);

 // Advance 4.9 seconds of idle -> still normal
 for(let i=0;i<4.9*50;i++){
  const base=motion.update(0.02);
  beast.update(base,0.02,{canIdle:true});
 }
 assert.equal(beast.state,'normal');
 assert.equal(beast.progress,0);

 // Advance past 5.0s -> starts transforming into Beast Mode
 for(let i=0;i<15;i++){
  const base=motion.update(0.02);
  beast.update(base,0.02,{canIdle:true});
 }
 assert.equal(beast.state,'transforming');
 const midProgress=beast.progress;
 assert.ok(midProgress>0.15&&midProgress<0.6);

 // Interrupt mid-transformation! Must reverse smoothly from exact midProgress without jumping
 beast.interrupt();
 assert.equal(beast.state,'reverting');
 assert.equal(beast.progress,midProgress);
 const nextStep=beast.update(motion.update(0.02),0.02,{canIdle:false});
 assert.ok(beast.progress<midProgress&&beast.progress>0);
 assert.ok(Object.values(nextStep).every(Number.isFinite));

 // Complete reverting back to Normal
 for(let i=0;i<30;i++)beast.update(motion.update(0.02),0.02,{canIdle:false});
 assert.equal(beast.state,'normal');
 assert.equal(beast.progress,0);
 assert.equal(nova.root.getObjectByName('beastTorso')?.visible,false);

 // Now let idle run full 5.0s + 1.0s to reach 100% Beast Mode
 for(let i=0;i<310;i++)beast.update(motion.update(0.02),0.02,{canIdle:true});
 const fullPose=beast.update(motion.update(0.02),0.02,{canIdle:true});
 assert.equal(beast.state,'beast');
 assert.equal(beast.progress,1);
 assert.equal(nova.root.getObjectByName('beastTorso')?.visible,true);
 assert.equal(nova.root.getObjectByName('leftBeastBiceps')?.visible,true);
 assert.equal(nova.root.getObjectByName('rightBeastBiceps')?.visible,true);

 // Head scale must remain [1, 1, 1] while shoulders widen dramatically (> 2.6)
 const snap=beast.snapshot();
 assert.deepEqual(snap.headScale,[1,1,1]);
 assert.ok(snap.shoulderSpan>2.6);

 // Double-biceps pose checks: arms raised horizontally and elbows flexed sharply upward, fists clenched
 assert.ok(fullPose.rightShoulderZ<-1.4);
 assert.ok(fullPose.leftShoulderZ>1.4);
 assert.ok(fullPose.rightElbowZ<-1.7);
 assert.ok(fullPose.leftElbowZ>1.7);
 assert.ok(nova.root.getObjectByName('rightFinger0')!.rotation.x<-1.2);
 assert.ok(nova.root.getObjectByName('leftFinger0')!.rotation.x<-1.2);

 // Holds Beast Mode indefinitely until user interacts
 for(let i=0;i<200;i++)beast.update(motion.update(0.02),0.02,{canIdle:true});
 assert.equal(beast.state,'beast');
 assert.equal(beast.progress,1);

 nova.dispose();
 assert.equal(nova.root.children.length,0);
});
