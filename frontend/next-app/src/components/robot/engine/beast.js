import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>{const x=clamp(t,0,1);return x*x*(3-2*x);};
const subStep=(p,a,b)=>smooth((p-a)/Math.max(1e-5,b-a));
// Slight muscular pop overshoot only when flexing up into Beast Mode
const musclePop=(p,reverting)=>{
 const x=clamp(p,0,1);
 if(reverting)return x*x*(3-2*x);
 const c1=1.70158,c3=c1+1;
 return clamp(1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2),0,1.08);
};

export const BEAST_IDLE_SECONDS=5.0;
export const BEAST_UP_DURATION=0.85;
export const BEAST_DOWN_DURATION=0.38;

/**
 * Attaches procedural 3D bodybuilder muscle geometry onto existing NOVA joints
 * without modifying engine/model.js or scaling the head/face/eyes.
 */
export function attachBeastRig(nova){
 const [ceramic,pearl,metal,rubber,,cyan,violet,pink,eyeMat,whiteGlow]=nova.materials;
 const cache=nova.geometryCache;
 const box=(w,h,d,r=.08)=>{
  const key=`beast:${w},${h},${d},${r}`;
  if(!cache.has(key))cache.set(key,new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/2,h/2,d/2)));
  return cache.get(key);
 };
 const sphere=cache.get('sphere')||new T.SphereGeometry(1,20,12);
 const cyl=(rt,rb,h)=>{
  const key=`beast:c:${rt},${rb},${h}`;
  if(!cache.has(key))cache.set(key,new T.CylinderGeometry(rt,rb,h,28));
  return cache.get(key);
 };
 const torus=(r,tube)=>{
  const key=`beast:t:${r},${tube}`;
  if(!cache.has(key))cache.set(key,new T.TorusGeometry(r,tube,10,40));
  return cache.get(key);
 };
 const addMesh=(parent,geo,mat,x=0,y=0,z=0,sx=1,sy=1,sz=1)=>{
  const m=new T.Mesh(geo,mat);
  m.position.set(x,y,z);
  m.scale.set(sx,sy,sz);
  m.castShadow=mat!==eyeMat&&mat!==whiteGlow;
  m.receiveShadow=true;
  parent.add(m);
  nova.pickables.push(m);
  return m;
 };
 const addGroup=(parent,name,x=0,y=0,z=0)=>{
  const g=new T.Group();
  g.name=name;
  g.position.set(x,y,z);
  g.visible=false;
  parent.add(g);
  return g;
 };

 const {torso,pelvis,neck}=nova.joints;

 // 1. Torso Muscle Rig (Colossal Bodybuilder Chest, Traps, V-Taper Lats, 6-Pack Abs, Rear Rhomboids)
 const torsoRig=addGroup(torso,'beastTorso',0,0,0);
 for(const sign of [-1,1]){
  // Massive sloping Trapezius yoke bridging neck to shoulders with zero gap
  const trap=addMesh(torsoRig,box(.92,.54,.68,.18),ceramic,sign*.58,1.12,-.02);
  trap.rotation.z=-sign*.34;
  const trapStripe=addMesh(torsoRig,box(.56,.05,.7,.02),sign<0?cyan:pink,sign*.62,1.28,-.01);
  trapStripe.rotation.z=-sign*.34;
  // Upper clavicle & shoulder socket bridge
  const clav=addMesh(torsoRig,box(1.06,.28,.58,.1),pearl,sign*.64,.98,.2);
  clav.rotation.z=-sign*.1;
  // Colossal Pectoral armor/muscle plates (total chest width ~2.35 units, seamlessly meeting deltoids)
  const pec=addMesh(torsoRig,box(1.14,.68,.66,.2),ceramic,sign*.58,.68,.28);
  pec.rotation.y=-sign*.12;
  pec.rotation.x=-.08;
  // Lower pectoral neon underglow strip
  const pecGlow=addMesh(torsoRig,box(.88,.048,.05,.018),sign<0?cyan:pink,sign*.58,.36,.58);
  pecGlow.rotation.y=-sign*.12;
  // Wide V-taper Latissimus Dorsi wings flaring outward to connect under armpits
  const lat=addMesh(torsoRig,box(.72,.96,.64,.18),ceramic,sign*.94,.56,-.04);
  lat.rotation.z=sign*.38;
  const latTrim=addMesh(torsoRig,box(.18,.76,.66,.05),pearl,sign*1.14,.6,-.04);
  latTrim.rotation.z=sign*.38;
  // Serratus / oblique side ribs
  for(let r=0;r<3;r++){
   const rib=addMesh(torsoRig,box(.3,.1,.48,.04),r%2?pearl:metal,sign*(.72-r*.04),.34-r*.12,.18);
   rib.rotation.z=sign*.22;
  }
 }
 // Sternum center lock & muscular neck collar
 addMesh(torsoRig,cyl(.32,.42,.3),metal,0,1.15,.04);
 const neckRing=addMesh(torsoRig,torus(.35,.03),cyan,0,1.26,.04);
 neckRing.rotation.x=Math.PI/2;
 addMesh(torsoRig,box(.32,.58,.56,.08),rubber,0,.66,.26);
 // 6-Pack Sculpted Abdominal Core
 const absGroup=new T.Group();
 absGroup.position.set(0,-.02,0);
 torsoRig.add(absGroup);
 addMesh(absGroup,box(1.12,.64,.62,.15),rubber,0,.2,.1);
 for(let row=0;row<3;row++){
  const y=.4-row*.165;
  const w=.36-row*.022;
  for(const sign of [-1,1]){
   addMesh(absGroup,box(w,.14,.22,.055),ceramic,sign*(w*.55),y,.36);
  }
 }
 // Massive Upper Back & Rear Reactor
 addMesh(torsoRig,box(1.68,.86,.48,.18),metal,0,.68,-.38);
 addMesh(torsoRig,box(1.42,.66,.28,.12),pearl,0,.72,-.5);
 addMesh(torsoRig,box(.08,.56,.05,.02),violet,-.24,.7,-.63);
 addMesh(torsoRig,box(.08,.56,.05,.02),cyan,.24,.7,-.63);

 // 2. Pelvis / Glute Power Girdle
 const pelvisRig=addGroup(pelvis,'beastPelvis',0,0,0);
 addMesh(pelvisRig,box(1.38,.38,.76,.14),rubber,0,.02,0);
 addMesh(pelvisRig,box(1.48,.3,.82,.13),ceramic,0,.06,0);
 addMesh(pelvisRig,box(.68,.16,.06,.03),metal,0,.06,.41);
 addMesh(pelvisRig,box(.38,.05,.065,.015),cyan,0,.06,.43);

 // 3. Left & Right Arm + Leg Muscle Rigs
 const sides={};
 for(const sign of [-1,1]){
  const side=sign===-1?'right':'left';
  const accent=sign<0?cyan:pink;
  const shoulder=nova.joints[`${side}Shoulder`];
  const elbow=nova.joints[`${side}Elbow`];
  const wrist=nova.joints[`${side}Wrist`];
  const hip=nova.joints[`${side}Hip`];
  const knee=nova.joints[`${side}Knee`];
  const ankle=nova.joints[`${side}Ankle`];

  // 3a. 3-Headed Capped Deltoid Boulder & Connected Upper Arm Shaft
  // Note: when shoulder.rotation.z = sign * 1.48, local (-Y) extends horizontally OUTWARD,
  // local (sign * X) points STRAIGHT UP (World +Y), and local (-sign * X) points STRAIGHT DOWN (World -Y)!
  const shoulderRig=addGroup(shoulder,`${side}BeastShoulder`,0,0,0);
  // Inner shoulder collar socket bridging into chest/traps
  addMesh(shoulderRig,cyl(.34,.34,.36),metal,0,.08,0);
  // Lateral/top deltoid cap
  addMesh(shoulderRig,box(.68,.62,.68,.24),ceramic,sign*.12,-.08,0);
  addMesh(shoulderRig,box(.54,.52,.56,.18),pearl,sign*.06,-.1,.14);
  addMesh(shoulderRig,box(.54,.52,.56,.18),pearl,sign*.06,-.1,-.14);
  const deltRing=addMesh(shoulderRig,torus(.36,.034),accent,sign*.04,-.04,0);
  deltRing.rotation.y=Math.PI/2;
  // Continuous Upper Arm Core Shaft & Thick Triceps Horseshoe hanging underneath (-sign * X = World -Y)
  addMesh(shoulderRig,box(.44,.76,.46,.16),rubber,0,-.48,0);
  addMesh(shoulderRig,box(.5,.66,.52,.2),ceramic,-sign*.18,-.5,-.02);
  addMesh(shoulderRig,box(.38,.5,.42,.15),pearl,-sign*.3,-.52,-.02);

  // 3b. Colossal Biceps Peak Group positioned at (y = -0.48, x = +sign * 0.24) so it pops STRAIGHT UP (World +Y)
  // right in the middle of the horizontal upper arm between the deltoid (y=-0.08) and elbow (y=-0.92)!
  const bicepsGroup=addGroup(shoulder,`${side}BeastBiceps`,sign*.25,-.48,.06);
  // Main rounded biceps peak dome
  addMesh(bicepsGroup,sphere,ceramic,0,0,0,.38,.36,.34);
  // Inner short-head biceps fullness
  addMesh(bicepsGroup,sphere,pearl,sign*.06,.04,.09,.3,.28,.28);
  // Glowing power vein across the top crest of the biceps peak
  addMesh(bicepsGroup,box(.055,.38,.08,.025),accent,sign*.33,0,.04);
  addMesh(bicepsGroup,box(.045,.18,.22,.02),whiteGlow,sign*.35,.02,.06);

  // 3c. Massive Forearm Bracer & Brachioradialis (extends from elbow at y=0 to wrist at y=-0.76)
  const forearmRig=addGroup(elbow,`${side}BeastForearm`,0,0,0);
  addMesh(forearmRig,sphere,metal,0,0,0,.25,.25,.25);
  // Thick upper forearm muscle belly
  addMesh(forearmRig,box(.56,.48,.54,.18),ceramic,0,-.26,.03);
  // Tapering lower forearm gauntlet
  addMesh(forearmRig,box(.46,.42,.46,.15),pearl,0,-.54,.02);
  addMesh(forearmRig,box(.08,.44,.055,.02),accent,sign*.24,-.38,.09);
  const wristCuff=addMesh(forearmRig,torus(.24,.03),accent,0,-.7,0);
  wristCuff.rotation.x=Math.PI/2;

  // 3d. Heavy Bodybuilder Clenched Fist (clearly visible above the biceps peak!)
  const fistRig=addGroup(wrist,`${side}BeastFist`,0,0,0);
  addMesh(fistRig,box(.48,.38,.44,.13),ceramic,0,-.18,.04);
  addMesh(fistRig,box(.44,.18,.18,.06),pearl,0,-.33,.13);
  // Curled thumb lock across the fist
  const thumb=addMesh(fistRig,box(.18,.16,.18,.055),metal,-sign*.15,-.2,.2);
  thumb.rotation.z=-sign*.35;

  // 3e. Quad Sweep & Calf Thrusters
  const thighRig=addGroup(hip,`${side}BeastThigh`,0,0,0);
  addMesh(thighRig,box(.68,.66,.68,.22),ceramic,sign*.04,-.3,.04);
  // Teardrop Vastus Medialis inner quad
  addMesh(thighRig,sphere,pearl,-sign*.1,-.42,.15,.26,.32,.26);
  addMesh(thighRig,box(.08,.38,.05,.02),accent,sign*.31,-.3,.14);

  const calfRig=addGroup(knee,`${side}BeastCalf`,0,0,0);
  addMesh(calfRig,box(.42,.28,.26,.08),rubber,0,-.02,.21);
  addMesh(calfRig,box(.56,.58,.58,.18),ceramic,0,-.3,-.02);
  addMesh(calfRig,box(.075,.34,.045,.015),accent,sign*.25,-.3,.23);

  const footRig=addGroup(ankle,`${side}BeastFoot`,0,0,0);
  addMesh(footRig,box(.62,.26,.82,.11),ceramic,0,-.1,.16);
  addMesh(footRig,box(.62,.08,.8,.035),rubber,0,-.21,.16);

  sides[side]={shoulderRig,bicepsGroup,forearmRig,fistRig,thighRig,calfRig,footRig};
 }

 // Save rest positions for joints we translate or curl during Beast Mode
 const fingerNames=['rightFinger0','rightFinger1','rightFinger2','leftFinger0','leftFinger1','leftFinger2'];
 for(const f of fingerNames){
  const joint=nova.joints[f];
  if(joint&&!nova.rest.has(f))nova.rest.set(f,{position:joint.position.clone(),rotation:joint.rotation.clone()});
 }
 for(const name of ['pelvis','neck','core','rightAnkle','leftAnkle']){
  const joint=nova.joints[name];
  if(joint&&!nova.rest.has(name))nova.rest.set(name,{position:joint.position.clone(),rotation:joint.rotation.clone()});
 }

 return {torsoRig,pelvisRig,sides,neck};
}

/**
 * Controls the 5-second idle timer, reversible Normal <-> Beast morph progress,
 * anatomical staggered scaling, and Front Double-Biceps pose composition.
 */
export class BeastController{
 constructor(nova){
  this.nova=nova;
  this.rig=attachBeastRig(nova);
  this.state='normal'; // 'normal' | 'transforming' | 'beast' | 'reverting'
  this.progress=0;
  this.target=0;
  this.idleSeconds=0;
  this.autoIdle=true;
  this.manualMorph=null;
  this.flexTime=0;
 }
 /** Immediately interrupts Beast Mode (or mid-transformation) and smoothly shrinks from current progress */
 interrupt(){
  this.idleSeconds=0;
  this.manualMorph=null;
  this.target=0;
  if(this.progress>0)this.state='reverting';
  else this.state='normal';
 }
 /** Explicitly activates or deactivates Beast Mode (used by controller or preview lab) */
 setActive(active){
  this.manualMorph=null;
  if(active){
   this.target=1;
   this.state=this.progress>=0.999?'beast':'transforming';
  }else{
   this.interrupt();
  }
 }
 /** Scrubs morph directly between 0 and 1 for standalone Character Lab inspection */
 setMorph(value){
  if(value===null||value===undefined||Number.isNaN(Number(value))){
   this.manualMorph=null;
   return;
  }
  const v=clamp(Number(value),0,1);
  this.manualMorph=v;
  this.progress=v;
  this.target=v>0.5?1:0;
  this.state=v<=0.001?'normal':v>=0.999?'beast':'transforming';
 }
 reset(){
  this.idleSeconds=0;
  this.manualMorph=null;
  this.target=0;
  this.progress=0;
  this.flexTime=0;
  this.state='normal';
  this.applyGeometry(0,0);
 }
 update(basePose,dt,{canIdle=true,reduced=false,paused=false}={}){
  if(reduced){
   if(this.manualMorph===null){
    this.idleSeconds=0;
    this.target=0;
    this.progress=0;
    this.state='normal';
   }
   this.applyGeometry(this.progress,0);
   return basePose;
  }
  const step=paused?0:clamp(dt,0,.05);
  if(this.manualMorph!==null){
   this.progress=this.manualMorph;
   this.flexTime+=step;
  }else{
   if(this.autoIdle&&canIdle&&this.target===0){
    this.idleSeconds+=step;
    if(this.idleSeconds>=BEAST_IDLE_SECONDS){
     this.target=1;
     this.state='transforming';
    }
   }else if(!canIdle&&this.target===1){
    this.interrupt();
   }
   if(this.target===1&&this.progress<1){
    this.progress=Math.min(1,this.progress+step/BEAST_UP_DURATION);
    this.state=this.progress>=1?'beast':'transforming';
   }else if(this.target===0&&this.progress>0){
    this.progress=Math.max(0,this.progress-step/BEAST_DOWN_DURATION);
    this.state=this.progress<=0?'normal':'reverting';
   }
   if(this.progress>0)this.flexTime+=step;
   else this.flexTime=0;
  }

  this.applyGeometry(this.progress,this.flexTime);
  if(this.progress<=0.0001)return basePose;

  // Compose Front Double-Biceps Pose blended smoothly with current small NOVA pose
  const p=smooth(this.progress);
  const pulse=Math.sin(this.flexTime*4.2);
  const breathe=Math.sin(this.flexTime*2.2);
  const beastPose={
   rootY:.08+.026*breathe,
   rootZ:0,
   torsoX:-.08+.02*pulse,
   torsoY:.04*Math.sin(this.flexTime*1.3),
   torsoZ:0,
   // Head stays proud in Beast Mode, and immediately follows AuthPose when reverting
   headX:this.state==='reverting'?basePose.headX:basePose.headX*.35-.03,
   headY:this.state==='reverting'?basePose.headY:basePose.headY*.45,
   headZ:this.state==='reverting'?basePose.headZ:basePose.headZ*.3,
   // Classic Front Double-Biceps:
   // ShoulderZ lifts upper arms horizontally outward; ElbowZ (~103 deg) bends forearms UPWARD & slightly inward!
   rightShoulderZ:-1.46+.03*pulse,
   leftShoulderZ:1.46-.03*pulse,
   rightShoulderY:-.14,
   leftShoulderY:.14,
   rightShoulderX:0,
   leftShoulderX:0,
   rightElbowZ:-1.82-.07*pulse,
   leftElbowZ:1.82+.07*pulse,
   rightElbowX:-.14,
   leftElbowX:-.14,
   rightWristZ:-.32-.05*pulse,
   leftWristZ:.32+.05*pulse,
   // Wide grounded power stance
   rightHipX:-.08,
   leftHipX:-.08,
   rightHipZ:-.14,
   leftHipZ:.14,
   rightKneeX:.16,
   leftKneeX:.16
  };

  const out={...basePose};
  for(const key of Object.keys(beastPose)){
   const baseVal=basePose[key]||0;
   out[key]=baseVal+(beastPose[key]-baseVal)*p;
  }
  return out;
 }

 applyGeometry(p,flexTime){
  const {joints,rest}=this.nova;
  const active=p>0.0001;
  const reverting=this.state==='reverting';
  const chestPhase=subStep(p,0,.74);
  const armPhase=subStep(p,.06,.86);
  const bicepsPop=musclePop((p-.14)/.86,reverting);
  const legPhase=subStep(p,0,.68);
  const pulse=active?1+.065*Math.sin(flexTime*4.2)*smooth(p):1;

  // Keep head, face, and cyan eyes at 100% original scale (1,1,1) ALWAYS
  joints.head.scale.set(1,1,1);
  joints.neck.scale.set(1,1,1);
  joints.torso.scale.set(1,1,1);

  // Toggle visibility & scale of Beast muscle groups
  this.rig.torsoRig.visible=active;
  this.rig.pelvisRig.visible=active;
  if(active){
   const cs=Math.max(.001,chestPhase);
   this.rig.torsoRig.scale.set(cs*(.94+.06*pulse),cs,cs*(.94+.06*pulse));
   const ps=Math.max(.001,legPhase);
   this.rig.pelvisRig.scale.set(ps,ps,ps);
  }

  // Translate joint origins smoothly from rest positions
  const torsoRest=rest.get('torso').position;
  const pelvisRest=rest.get('pelvis').position;
  const neckRest=rest.get('neck').position;
  const coreRest=rest.get('core').position;

  joints.torso.position.set(torsoRest.x,torsoRest.y+.42*chestPhase,torsoRest.z);
  joints.pelvis.position.set(pelvisRest.x,pelvisRest.y+.3*legPhase,pelvisRest.z);
  joints.neck.position.set(neckRest.x,neckRest.y+.42*chestPhase,neckRest.z+.06*chestPhase);
  joints.core.position.set(coreRest.x,coreRest.y+.22*chestPhase,coreRest.z+.32*chestPhase);
  const coreScale=1+.48*chestPhase;
  joints.core.scale.set(coreScale,coreScale,coreScale);

  for(const sign of [-1,1]){
   const side=sign===-1?'right':'left';
   const sRig=this.rig.sides[side];
   sRig.shoulderRig.visible=active;
   sRig.bicepsGroup.visible=active;
   sRig.forearmRig.visible=active;
   sRig.fistRig.visible=active;
   sRig.thighRig.visible=active;
   sRig.calfRig.visible=active;
   sRig.footRig.visible=active;

   const shRest=rest.get(`${side}Shoulder`).position;
   const elRest=rest.get(`${side}Elbow`).position;
   const wrRest=rest.get(`${side}Wrist`).position;
   const hpRest=rest.get(`${side}Hip`).position;
   const knRest=rest.get(`${side}Knee`).position;
   const anRest=rest.get(`${side}Ankle`).position;

   // Seamless shoulder widening (±0.66 -> ±1.35, total shoulder socket span 2.70, elbow span > 4.5!)
   joints[`${side}Shoulder`].position.set(
    shRest.x+sign*.69*chestPhase,
    shRest.y+.32*chestPhase,
    shRest.z+.06*chestPhase
   );
   // Extend upper arm length (-0.56 -> -0.94) so elbow clears the huge biceps peak cleanly
   joints[`${side}Elbow`].position.set(elRest.x,elRest.y-.38*armPhase,elRest.z);
   // Extend forearm length (-0.49 -> -0.76) so clenched fists rise high above the biceps peaks
   joints[`${side}Wrist`].position.set(wrRest.x,wrRest.y-.27*armPhase,wrRest.z);

   // Wide stance & leg extension so feet remain grounded
   joints[`${side}Hip`].position.set(hpRest.x+sign*.28*legPhase,hpRest.y-.02*legPhase,hpRest.z);
   joints[`${side}Knee`].position.set(knRest.x,knRest.y-.16*legPhase,knRest.z);
   joints[`${side}Ankle`].position.set(anRest.x,anRest.y-.14*legPhase,anRest.z);
   joints[`${side}Ankle`].rotation.z=-sign*.14*legPhase;

   if(active){
    const as=Math.max(.001,armPhase);
    const bs=Math.max(.001,bicepsPop);
    const ls=Math.max(.001,legPhase);
    sRig.shoulderRig.scale.set(as,as,as);
    // Biceps peak swells extra large and pulses while flexing
    sRig.bicepsGroup.scale.set(bs*1.26*pulse,bs*1.18*pulse,bs*1.22*pulse);
    sRig.forearmRig.scale.set(as*1.08,as*1.08,as*1.08);
    sRig.fistRig.scale.set(as*1.15,as*1.15,as*1.15);
    sRig.thighRig.scale.set(ls,ls,ls);
    sRig.calfRig.scale.set(ls,ls,ls);
    sRig.footRig.scale.set(ls,ls,ls);
   }

   // Curl fingers into clenched bodybuilding fists
   for(let f=0;f<3;f++){
    const fName=`${side}Finger${f}`;
    const finger=joints[fName];
    const fRest=rest.get(fName);
    if(finger&&fRest){
     finger.rotation.x=fRest.rotation.x-1.35*armPhase;
    }
   }
  }
 }

 snapshot(){
  return {
   state:this.state,
   active:this.state==='beast'||this.state==='transforming',
   progress:Number(this.progress.toFixed(4)),
   idleSeconds:Number(this.idleSeconds.toFixed(2)),
   headScale:this.nova.joints.head.scale.toArray(),
   shoulderSpan:Number((this.nova.joints.leftShoulder.position.x-this.nova.joints.rightShoulder.position.x).toFixed(3))
  };
 }
}
