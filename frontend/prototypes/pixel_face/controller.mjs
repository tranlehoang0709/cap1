import {EXPRESSIONS} from './registry.mjs';

export class ExpressionController {
  constructor({random=Math.random}={}) {
    this.random=random;
    this.paused=false;
    this.reducedMotion=false;
    this.visible=true;
    this.state={id:'neutral',previous:'neutral',transition:1,time:0,eyeOpen:1,
      lookX:0,lookY:0,offsetY:0,mouthPulse:0,blinkCount:0};
    this.resetTiming();
  }
  resetTiming() {
    const preset=EXPRESSIONS[this.state.id];
    this.nextBlink=preset.blinkMin+this.random()*(preset.blinkMax-preset.blinkMin);
    this.blinkAt=-Infinity;
    this.nextLook=1+this.random()*2;
    this.targetX=0; this.targetY=0;
  }
  setExpression(id) {
    if(!Object.hasOwn(EXPRESSIONS,id)) return false;
    if(id===this.state.id) return true;
    const s=this.state;
    s.previous=s.id; s.id=id; s.transition=this.moving?0:1;
    s.time=0; s.eyeOpen=1; s.lookX=0; s.lookY=0; s.offsetY=0; s.mouthPulse=0;
    this.resetTiming();
    return true;
  }
  get moving() {return !this.paused && !this.reducedMotion && this.visible;}
  setPaused(value) {this.paused=Boolean(value);}
  setReducedMotion(value) {
    this.reducedMotion=Boolean(value);
    if(this.reducedMotion){
      Object.assign(this.state,{transition:1,eyeOpen:1,lookX:0,lookY:0,offsetY:0,mouthPulse:0});
      this.blinkAt=-Infinity;
      this.nextBlink=this.state.time+EXPRESSIONS[this.state.id].blinkMin;
    }
  }
  setVisible(value) {this.visible=Boolean(value);}
  update(seconds) {
    const s=this.state;
    if(!this.moving) return s;
    const dt=Math.min(0.08,Math.max(0,Number.isFinite(seconds)?seconds:0));
    const preset=EXPRESSIONS[s.id];
    s.time+=dt;
    s.transition=Math.min(1,s.transition+dt/0.32);
    if(s.time>=this.nextLook){
      this.targetX=(this.random()-0.5)*3.5;
      this.targetY=(this.random()-0.5)*1.3;
      this.nextLook=s.time+1.6+this.random()*3.1;
    }
    const blend=1-Math.exp(-dt*3);
    s.lookX+=(this.targetX-s.lookX)*blend;
    s.lookY+=(this.targetY-s.lookY)*blend;
    if(s.time>=this.nextBlink){
      this.blinkAt=s.time; s.blinkCount++;
      this.nextBlink=s.time+preset.blinkMin+this.random()*(preset.blinkMax-preset.blinkMin);
    }
    const phase=(s.time-this.blinkAt)/preset.blinkDuration;
    s.eyeOpen=phase>=0 && phase<1 ? 1-Math.sin(Math.PI*phase)**2 : 1;
    const wave=Math.sin(s.time*preset.tempo);
    s.offsetY=s.id==='happy'?-Math.abs(wave)*1.1:s.id==='angry'?Math.sin(s.time*24)*(s.time%4<0.22?0.7:0):wave*(s.id==='sad'?0.35:0.6);
    s.mouthPulse=wave;
    return s;
  }
}
