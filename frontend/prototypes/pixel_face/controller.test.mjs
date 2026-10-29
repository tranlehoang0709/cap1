import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExpressionController} from './controller.mjs';
import {EXPRESSIONS,EXPRESSION_IDS} from './registry.mjs';
import {PixelFaceRenderer} from './renderer.mjs';

const make=()=>new ExpressionController({random:()=>0.5});
test('registry has five original IDs; unknown IDs do not change state',()=>{
  const c=make();
  assert.deepEqual(EXPRESSION_IDS,['neutral','happy','angry','sad','sleepy']);
  for(const invalid of ['excited','__proto__','speaking',null])assert.equal(c.setExpression(invalid),false);
  assert.equal(c.state.id,'neutral');
  assert.ok(Object.isFrozen(EXPRESSIONS));
});
test('all expressions blink, look around and animate mouths within bounded offsets',()=>{
  for(const id of EXPRESSION_IDS){
    const c=make();c.setExpression(id);
    let closed=false,look=false,mouth=false;
    for(let i=0;i<1400;i++){
      const s=c.update(1/60);
      closed ||= s.eyeOpen<0.2;look ||= Math.abs(s.lookX)+Math.abs(s.lookY)>0.01;mouth ||= Math.abs(s.mouthPulse)>0.1;
      assert.ok(Math.abs(s.lookX)<=1.76 && Math.abs(s.lookY)<=0.66 && Math.abs(s.offsetY)<=1.11);
    }
    // Một RNG cố định .5 cho gaze trung tâm; dùng RNG lệch để kiểm tra di chuyển.
    const gaze=new ExpressionController({random:()=>0.8});
    for(let i=0;i<300;i++)gaze.update(1/60);
    assert.ok(Math.abs(gaze.state.lookX)>0.1);
    assert.ok(closed && mouth && c.state.blinkCount>0,id);
  }
});
test('switch resets transient timing and has no cumulative drift',()=>{
  const c=make();
  for(let repeat=0;repeat<80;repeat++)for(const id of EXPRESSION_IDS){
    const unchanged=c.state.id===id;
    c.setExpression(id);
    assert.equal(c.state.time,0);assert.equal(c.state.eyeOpen,1);
    assert.equal(c.state.offsetY,0);assert.equal(c.state.lookX,0);
    assert.equal(c.state.transition,unchanged?1:0);
    for(let i=0;i<30;i++)c.update(1/60);
    assert.equal(c.state.transition,1);
  }
});
test('pause, invisibility and reduced motion freeze time; static selection still works',()=>{
  const c=make();c.update(0.08);
  for(const mode of ['pause','hidden','reduce']){
    if(mode==='pause')c.setPaused(true);
    if(mode==='hidden')c.setVisible(false);
    if(mode==='reduce')c.setReducedMotion(true);
    const time=c.state.time;c.update(10);assert.equal(c.state.time,time);
    c.setExpression(c.state.id==='happy'?'sad':'happy');
    assert.equal(c.state.transition,1);
    c.setPaused(false);c.setVisible(true);c.setReducedMotion(false);
  }
  assert.ok(c.update(999).time<=0.081);
});
test('renderer produces distinct original silhouettes at default and configurable resolution',()=>{
  function canvas(width,height){
    const pixels=new Set();
    const ctx={fillStyle:'',globalAlpha:1,imageSmoothingEnabled:true,setTransform(){},fillRect(x,y,w,h){if(w===1&&h===1)pixels.add(`${x},${y}`);}};
    return {width,height,pixels,getContext(){return ctx;}};
  }
  const output=[];
  for(const id of EXPRESSION_IDS){
    const target=canvas(),r=new PixelFaceRenderer(target),c=make();
    c.setReducedMotion(true);c.setExpression(id);r.render(c.state,{motion:false});
    output.push([...target.pixels].sort().join('|'));
    assert.equal(target.width,128);assert.equal(target.height,64);
  }
  assert.equal(new Set(output).size,5);
  const large=canvas();new PixelFaceRenderer(large,{width:256,height:128});
  assert.equal(large.width,256);
  assert.throws(()=>new PixelFaceRenderer(canvas(),{width:0,height:64}),RangeError);
});
