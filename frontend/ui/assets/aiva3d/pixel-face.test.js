import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRobot,animateRobot} from './model.js';
import {createPixelFace,EXPRESSION_IDS} from './pixel-face.js';

function setup(){
  const robot=createRobot();let canvases=0;
  const context={globalAlpha:1,fillStyle:'',setTransform(){},fillRect(){}};
  const face=createPixelFace(robot,{createCanvas(){canvases++;return{width:0,height:0,getContext(){return context;}};}});
  return{robot,face,get canvases(){return canvases;}};
}
test('pixel surface is 2:1, head-attached, nearest-filtered and hides conflicting meshes',()=>{
  const s=setup(),{robot,face}=s;
  assert.equal(face.mesh.parent,robot.head);
  assert.equal(face.mesh.geometry.parameters.width/face.mesh.geometry.parameters.height,2);
  assert.deepEqual([face.canvas.width,face.canvas.height],[128,64]);
  assert.equal(face.texture.magFilter,THREE.NearestFilter);
  assert.equal(face.texture.minFilter,THREE.NearestFilter);
  assert.equal(face.texture.generateMipmaps,false);
  assert.equal(face.texture.colorSpace,THREE.SRGBColorSpace);
  assert.equal(face.mesh.material.toneMapped,false);
  assert.ok(face.mesh.position.z>0.785);
  assert.ok([...robot.eyes,robot.mouth].every(m=>!m.visible));
  const uv=face.mesh.geometry.attributes.uv.array;
  assert.deepEqual([...uv],[0,1,1,1,0,0,1,0]);
  assert.equal(s.canvases,1);
});
test('five controllers stay local; pause, offline and reduced motion stay static',()=>{
  const a=setup(),b=setup();
  for(const id of EXPRESSION_IDS){
    assert.equal(a.face.setExpression(id),true);
    a.face.update(1/30,{moving:false});
    assert.equal(a.face.controller.state.id,id);
    assert.equal(b.face.controller.state.id,'neutral');
    const version=a.face.texture.version;
    a.face.update(1/30,{moving:false});assert.equal(a.face.texture.version,version);
    a.face.update(1/30,{moving:true});assert.ok(a.face.texture.version>version);
    const time=a.face.controller.state.time;
    a.face.update(1/30,{moving:false,reducedMotion:true});
    a.face.update(1/30,{moving:false,reducedMotion:true});
    assert.equal(a.face.controller.state.time,time);
  }
  b.face.update(1,{moving:false,online:false});
  assert.equal(b.face.controller.state.id,'neutral');
  assert.equal(b.face.controller.state.time,0);
  assert.equal(a.face.setExpression('speaking'),false);
});
test('legacy excited remains available internally and returns to the pixel face',()=>{
  const{robot,face}=setup();
  assert.equal(face.setExpression('excited'),true);
  assert.equal(face.mesh.visible,false);
  assert.ok([...robot.eyes,robot.mouth].every(m=>m.visible));
  face.setExpression('happy');assert.ok(face.mesh.visible);
  assert.ok([...robot.eyes,robot.mouth].every(m=>!m.visible));
  animateRobot(robot,2,1/30,1,true,true);
  assert.ok(robot.arms[1].shoulder.rotation.z>2);
  assert.equal(face.mesh.parent,robot.head);
});
test('integration resources dispose once without disposing shared robot materials',()=>{
  const{robot,face}=setup();const counts={texture:0,geometry:0,material:0,shell:0};
  face.texture.addEventListener('dispose',()=>counts.texture++);
  face.mesh.geometry.addEventListener('dispose',()=>counts.geometry++);
  face.mesh.material.addEventListener('dispose',()=>counts.material++);
  robot.body.children[0].material.addEventListener('dispose',()=>counts.shell++);
  face.dispose();face.dispose();face.update(1);assert.equal(face.setExpression('happy'),false);
  assert.deepEqual(counts,{texture:1,geometry:1,material:1,shell:0});
  assert.equal(face.mesh.parent,null);
});
