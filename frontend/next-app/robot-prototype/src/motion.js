// Pure bounded joint poses; rigid meshes never scale to create body motion.
export const durations={idle:Infinity,wave:3.5,dance:6.4,celebrate:4,react:1.5,blink:.25};
export const smooth=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
export const envelope=(t,d)=>smooth(t/.4)*smooth((d-t)/.45);
export function poseFor(action,t,{reduced=false,body=true,tracking=true,pointer={x:0,y:0}}={}){
 const pose={rootY:0,rootZ:0,torsoX:0,torsoY:0,torsoZ:0,headX:0,headY:0,headZ:0,rightShoulderX:0,rightShoulderZ:-.1,leftShoulderX:0,leftShoulderZ:.1,rightElbowX:-.12,leftElbowX:-.12,rightWristZ:0,leftWristZ:0,rightHipX:0,leftHipX:0,rightKneeX:0,leftKneeX:0};
 if(!reduced){pose.rootY=.018*Math.sin(t*1.8);pose.headZ=.018*Math.sin(t*1.1);if(body){pose.torsoY=.055*Math.sin(t*.65);pose.torsoZ=.012*Math.sin(t*1.2);}}
 if(tracking&&!reduced){pose.headY=Math.max(-.33,Math.min(.33,pointer.x*.32));pose.headX=Math.max(-.2,Math.min(.2,-pointer.y*.2));}
 if(action==='idle'||action==='blink')return pose;
 const d=durations[action]||1.5;const sample=reduced?d*.4:t;const w=reduced?1:envelope(sample,d);const s=Math.sin;
 if(action==='wave'){pose.rightShoulderZ=-2.05*w;pose.rightShoulderX=-.2*w;pose.rightElbowX=-.6*w;pose.rightWristZ=.3*s(sample*13)*w;pose.headZ=-.08*w;}
 if(action==='dance'){pose.torsoZ=.15*s(sample*5.5)*w;pose.torsoY=.22*s(sample*2.75)*w;pose.rootY=.07*(1-Math.cos(sample*11))*w;pose.rightShoulderZ=(-.5-.43*s(sample*5.5))*w;pose.leftShoulderZ=(.5-.43*s(sample*5.5))*w;pose.rightShoulderX=.45*s(sample*5.5)*w;pose.leftShoulderX=-.45*s(sample*5.5)*w;pose.rightHipX=.24*s(sample*5.5)*w;pose.leftHipX=-.24*s(sample*5.5)*w;pose.rightKneeX=.3*Math.max(0,s(sample*5.5))*w;pose.leftKneeX=.3*Math.max(0,-s(sample*5.5))*w;pose.headZ=-pose.torsoZ*.5;}
 if(action==='celebrate'){pose.rightShoulderZ=-2.3*w;pose.leftShoulderZ=2.3*w;pose.rightElbowX=-.45*w;pose.leftElbowX=-.45*w;pose.rootY=.2*Math.abs(s(sample*5))*w;pose.torsoZ=.06*s(sample*6)*w;pose.headX=-.1*w;}
 if(action==='react'){pose.rootZ=-.05*s(sample*6)*w;pose.headZ=.16*s(sample*7)*w;pose.headX=-.15*w;pose.rightShoulderZ=-.45*w;pose.leftShoulderZ=.45*w;pose.rightElbowX=-.5*w;pose.leftElbowX=-.5*w;}
 return pose;
}
export class MotionController{
 constructor(){this.time=0;this.actionTime=0;this.action='idle';this.paused=false;this.reduced=false;this.body=true;this.tracking=true;this.pointer={x:0,y:0};this.current=poseFor('idle',0);this.blinkAt=2.4;this.blinkTime=-1;this.emotion='curious';}
 trigger(action){if(!Object.hasOwn(durations,action))return;if(action==='blink'){this.blinkTime=0;return;}this.action=action;this.actionTime=0;}
 reset(){this.time=0;this.actionTime=0;this.action='idle';this.pointer={x:0,y:0};this.blinkTime=-1;this.blinkAt=2.4;this.current=poseFor('idle',0,{reduced:true});}
 update(delta){const dt=Math.max(0,Math.min(delta,.05));if(this.paused)return this.current;this.time+=dt;if(!this.reduced)this.actionTime+=dt;if(!this.reduced&&this.action!=='idle'&&this.actionTime>=durations[this.action]){this.action='idle';this.actionTime=0;}const target=poseFor(this.action,this.action==='idle'?this.time:this.actionTime,this);const blend=this.reduced?1:1-Math.exp(-dt*12);for(const key of Object.keys(target))this.current[key]+= (target[key]-this.current[key])*blend;
 if(!this.reduced&&this.time>this.blinkAt&&this.blinkTime<0){this.blinkTime=0;this.blinkAt=this.time+3.2+Math.sin(this.time)*.7;}
 if(this.blinkTime>=0){this.blinkTime+=dt;if(this.blinkTime>.25)this.blinkTime=-1;}
 return this.current;}
 get blink(){return this.blinkTime<0?1:Math.max(.06,1-Math.sin(Math.PI*this.blinkTime/.25));}
}
