import type {SmartMode} from '../NovaInteractionController';
/** A single pose compositor owns each joint. Never adds another animation loop. */
export class AuthPose{
 private mode:SmartMode='idle';private yaw=0;private pitch=0;private roll=0;private mask=0;private elapsed=0;
 setMode(mode:SmartMode){if(this.mode!==mode){this.elapsed=0;this.mode=mode;}}
 update<T extends Record<string,number>>(base:T,dt:number,reduced:boolean){this.elapsed+=dt;let yaw=base.headY,pitch=base.headX,roll=base.headZ;let mask=0;
  if(this.mode==='privacy'){yaw=-.62;pitch=.1;roll=-.025;mask=1;}
  else if(this.mode==='email'){yaw=.14+base.headY*.25;pitch=.015+base.headX*.2;}
  else if(this.mode==='thinking'){yaw=.12;pitch=-.08+(reduced?0:Math.sin(this.elapsed*2)*.015);roll=0;}
  else if(this.mode==='sad'){yaw=.04;pitch=.17;roll=-.07;}
  else if(this.mode==='worried'||this.mode==='confused'){yaw=.08;pitch=.04;roll=.1;}
  const k=reduced?1:1-Math.exp(-Math.min(dt,.05)*13);this.yaw+=(yaw-this.yaw)*k;this.pitch+=(pitch-this.pitch)*k;this.roll+=(roll-this.roll)*k;this.mask+=(mask-this.mask)*k;
  return {...base,headY:this.yaw,headX:this.pitch,headZ:this.roll};
 }
 get privacy(){return this.mask;}
 get state(){return this.mode;}
}
