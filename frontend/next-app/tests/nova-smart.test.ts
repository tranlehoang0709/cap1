import test from 'node:test';
import assert from 'node:assert/strict';
import {NovaInteractionController as Controller} from '../src/components/robot/NovaInteractionController';
import {AuthPose} from '../src/components/robot/engine/auth-pose';
const advance=(c:Controller,seconds:number)=>{for(let i=0;i<Math.ceil(seconds*60);i++)c.tick(1/60);};
test('greeting runs once per view and focus/blur restore idle without replay',()=>{
 const c=new Controller();c.send({type:'view',view:'login'});assert.equal(c.getSnapshot().action,'wave');advance(c,4);assert.equal(c.getSnapshot().mode,'idle');
 c.send({type:'view',view:'login'});assert.equal(c.getSnapshot().mode,'idle');c.send({type:'focus',field:'email'});assert.equal(c.getSnapshot().mode,'email');assert.equal(c.getSnapshot().tracking,true);c.send({type:'blur',field:'email'});assert.equal(c.getSnapshot().mode,'idle');
 c.send({type:'view',view:'register'});assert.equal(c.getSnapshot().action,'wave');c.send({type:'view',view:'login'});assert.equal(c.getSnapshot().mode,'idle');
});
test('privacy wins over processing, clicks, input, visibility, success and timeout',()=>{
 const c=new Controller();c.send({type:'focus',field:'password'});
 c.send({type:'submit',view:'login'});assert.equal(c.getSnapshot().mode,'privacy');
 for(const event of [{type:'input',field:'password'},{type:'visibility'},{type:'robot-click'},{type:'result',view:'login',outcome:'success'}] as const){c.send(event);advance(c,10);assert.equal(c.getSnapshot().mode,'privacy');assert.equal(c.getSnapshot().tracking,false);assert.equal(c.getSnapshot().action,'idle');assert.equal(c.getSnapshot().beast,false);}
 c.send({type:'blur',field:'password'});assert.equal(c.getSnapshot().mode,'success');advance(c,2);assert.equal(c.getSnapshot().mode,'idle');
 c.send({type:'focus',field:'confirm'});c.send({type:'mismatch',invalid:true});assert.equal(c.getSnapshot().mode,'privacy');c.send({type:'blur',field:'confirm'});assert.equal(c.getSnapshot().mode,'confused');
});
test('submit never implies success; only confirmed result starts celebration and register dance',()=>{
 const c=new Controller();c.send({type:'submit',view:'register'});advance(c,20);assert.equal(c.getSnapshot().mode,'thinking');assert.equal(c.getSnapshot().beast,false);
 c.send({type:'robot-click'});assert.equal(c.getSnapshot().mode,'thinking');c.send({type:'result',view:'register',outcome:'success'});assert.equal(c.getSnapshot().action,'celebrate');advance(c,1.3);assert.equal(c.getSnapshot().action,'dance');advance(c,2);assert.equal(c.getSnapshot().mode,'idle');
});
test('credential/network/server/validation errors have distinct bounded reactions, never per-character sad replay',()=>{
 for(const [outcome,mode] of [['credentials','sad'],['network','worried'],['server','worried'],['validation','confused']] as const){const c=new Controller();c.send({type:'submit',view:'login'});c.send({type:'result',view:'login',outcome});assert.equal(c.getSnapshot().mode,mode);c.send({type:'focus',field:'email'});assert.equal(c.getSnapshot().mode,mode);for(let i=0;i<5;i++)c.send({type:'input',field:'email'});assert.equal(c.getSnapshot().mode,'email');advance(c,4);assert.equal(c.getSnapshot().mode,'email');}
});
test('confirmation mismatch clears after actual matching validation, disposal silences subscribers',()=>{
 const c=new Controller();let calls=0;const unsubscribe=c.subscribe(()=>calls++);c.send({type:'mismatch',invalid:true});assert.equal(c.getSnapshot().mode,'confused');c.send({type:'mismatch',invalid:false});assert.equal(c.getSnapshot().mode,'idle');unsubscribe();c.send({type:'validation'});assert.equal(calls,2);c.dispose();c.send({type:'submit',view:'login'});advance(c,10);assert.equal(calls,2);
});
test('joint compositor eases privacy within neck limits and reduced motion resolves immediately',()=>{
 const p=new AuthPose();const base={headY:0,headX:0,headZ:0,rightElbowX:.3};p.setMode('privacy');const first=p.update(base,1/60,false);assert.ok(first.headY<0&&first.headY>-.62);
 let pose=first;for(let i=0;i<120;i++)pose=p.update({...base,headY:.2},1/60,false);assert.ok(Math.abs(pose.headY+.62)<.001);assert.ok(p.privacy>.999);assert.equal(pose.rightElbowX,.3);
 p.setMode('email');const immediate=p.update(base,0,true);assert.equal(p.privacy,0);assert.equal(immediate.headY,.14);p.setMode('privacy');assert.equal(p.update(base,0,true).headY,-.62);assert.equal(p.privacy,1);
});
test('Beast Mode activates after 5s of true idle, never during focus/pending, and immediately interrupts on any user interaction',()=>{
 const c=new Controller();
 assert.equal(c.getSnapshot().beast,false);
 advance(c,4.8);
 assert.equal(c.getSnapshot().beast,false);
 advance(c,0.3);
 assert.equal(c.getSnapshot().beast,true);
 assert.equal(c.getSnapshot().mode,'idle');

 // Focusing password immediately interrupts Beast Mode and enters privacy mode
 c.send({type:'focus',field:'password'});
 assert.equal(c.getSnapshot().beast,false);
 assert.equal(c.getSnapshot().mode,'privacy');

 // Even after 10s in password focus, Beast Mode never activates
 advance(c,10);
 assert.equal(c.getSnapshot().beast,false);

 // Blurring returns to idle and starts a fresh 5s timer
 c.send({type:'blur',field:'password'});
 assert.equal(c.getSnapshot().beast,false);
 advance(c,5.1);
 assert.equal(c.getSnapshot().beast,true);

 // Clicking robot or interacting immediately exits Beast Mode
 c.send({type:'robot-click'});
 assert.equal(c.getSnapshot().beast,false);
 assert.equal(c.getSnapshot().mode,'reaction');
});
