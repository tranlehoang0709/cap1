import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original procedural AIVA design. No external model, image, texture or rig.
export function createNova(){
 const geometryCache=new Map(),materials=[];
 const mat=(type,options)=>{const m=new T[type](options);materials.push(m);return m;};
 const ceramic=mat('MeshPhysicalMaterial',{color:0xe9e7e4,metalness:.27,roughness:.26,clearcoat:.8,clearcoatRoughness:.16});
 const pearl=mat('MeshPhysicalMaterial',{color:0xc3c9d1,metalness:.58,roughness:.22,clearcoat:.65});
 const metal=mat('MeshStandardMaterial',{color:0x303642,metalness:.88,roughness:.3});
 const rubber=mat('MeshStandardMaterial',{color:0x171b25,metalness:.25,roughness:.56});
 const glass=mat('MeshPhysicalMaterial',{color:0x070b1a,metalness:.36,roughness:.16,clearcoat:1,clearcoatRoughness:.06});
 const cyan=mat('MeshStandardMaterial',{color:0x42efff,emissive:0x23d9ff,emissiveIntensity:2.6,metalness:.3,roughness:.25});
 const violet=mat('MeshStandardMaterial',{color:0xb19aff,emissive:0x8856fb,emissiveIntensity:2,metalness:.3,roughness:.3});
 const pink=mat('MeshStandardMaterial',{color:0xff95d7,emissive:0xef50c0,emissiveIntensity:2,metalness:.3,roughness:.3});
 const eyeMat=mat('MeshBasicMaterial',{color:0x9af6ff,toneMapped:false});
 const whiteGlow=mat('MeshBasicMaterial',{color:0xc7fbff,toneMapped:false});
 const root=new T.Group();root.name='NOVA';
 const joints={};const eyes=[];const pickables=[];
 function group(parent,name,x=0,y=0,z=0){const g=new T.Group();g.name=name;g.position.set(x,y,z);parent.add(g);joints[name]=g;return g;}
 function box(w,h,d,r=.06){const key=[w,h,d,r].join(',');if(!geometryCache.has(key)){
  if(d<.25&&w>.08&&h>.08&&r>.025){const x=-w/2,y=-h/2,q=Math.min(r,w/2,h/2),shape=new T.Shape();shape.moveTo(x+q,y);shape.lineTo(x+w-q,y);shape.quadraticCurveTo(x+w,y,x+w,y+q);shape.lineTo(x+w,y+h-q);shape.quadraticCurveTo(x+w,y+h,x+w-q,y+h);shape.lineTo(x+q,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-q);shape.lineTo(x,y+q);shape.quadraticCurveTo(x,y,x+q,y);const g=new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,curveSegments:8,steps:1});g.translate(0,0,-d/2);geometryCache.set(key,g);}
  else geometryCache.set(key,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/2,h/2,d/2)));
 }return geometryCache.get(key);}
 function mesh(parent,geo,material,x=0,y=0,z=0){const m=new T.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=material!==eyeMat&&material!==whiteGlow;m.receiveShadow=true;parent.add(m);pickables.push(m);return m;}
 function shell(parent,w,h,d,material,x=0,y=0,z=0,r=.06){return mesh(parent,box(w,h,d,r),material,x,y,z);}
 const sphere=new T.SphereGeometry(1,20,12);geometryCache.set('sphere',sphere);
 function ball(parent,r,material,x=0,y=0,z=0){const m=mesh(parent,sphere,material,x,y,z);m.scale.setScalar(r);return m;}
 function cylinder(parent,rt,rb,h,material,x=0,y=0,z=0){const key=`c${rt},${rb},${h}`;if(!geometryCache.has(key))geometryCache.set(key,new T.CylinderGeometry(rt,rb,h,32));return mesh(parent,geometryCache.get(key),material,x,y,z);}
 function ring(parent,r,tube,material,x=0,y=0,z=0){const key=`r${r},${tube}`;if(!geometryCache.has(key))geometryCache.set(key,new T.TorusGeometry(r,tube,8,48));return mesh(parent,geometryCache.get(key),material,x,y,z);}
 function line(parent,points,material,radius=.015){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return mesh(parent,new T.TubeGeometry(curve,24,radius,6,false),material);}
 const pelvis=group(root,'pelvis',0,1.3,0);
 shell(pelvis,.85,.3,.5,rubber);shell(pelvis,.95,.2,.57,ceramic,0,.035,0,.09);
 shell(pelvis,.49,.09,.02,metal,0,.04,.3,.02);shell(pelvis,.2,.022,.025,cyan,0,.04,.315,.006);
 const torso=group(root,'torso',0,1.48,0);
 cylinder(torso,.22,.26,.23,metal,0,-.05,0);ring(torso,.245,.018,violet,0,-.06,0).rotation.x=Math.PI/2;
 shell(torso,1.03,.89,.63,ceramic,0,.48,0,.17);
 shell(torso,.82,.14,.58,pearl,0,.09,0,.04);
 // An inset triangular neural core and a separate outer trim, created as real geometry.
 const core=group(torso,'core',0,.5,.34);
 shell(core,.42,.43,.07,metal,0,0,0,.09);shell(core,.34,.35,.035,glass,0,0,.045,.07);
 line(core,[[-.1,-.09,.075],[0,.11,.075],[.1,-.09,.075]],cyan,.017);
 line(core,[[-.05,-.015,.075],[.05,-.015,.075]],whiteGlow,.012);
 shell(torso,.13,.025,.018,cyan,-.32,.78,.31,.008);shell(torso,.13,.025,.018,pink,.32,.78,.31,.008);
 for(let i=0;i<3;i++)shell(torso,.13,.018,.012,metal,.29,.2+i*.065,.322,.005);
 // Back-mounted power pack. This makes the rear three-quarter view designed too.
 shell(torso,.6,.58,.18,metal,0,.5,-.39,.1);
 shell(torso,.04,.36,.025,violet,-.13,.5,-.495,.01);shell(torso,.04,.26,.025,cyan,.13,.5,-.495,.01);
 for(const sign of [-1,1]){
  const side=sign===-1?'right':'left';
  const shoulder=group(torso,`${side}Shoulder`,sign*.66,.75,0);
  ball(shoulder,.185,metal);const cap=ring(shoulder,.18,.025,sign<0?cyan:pink);cap.rotation.y=Math.PI/2;
  shell(shoulder,.32,.3,.38,ceramic,sign*.025,-.08,0,.1);
  shell(shoulder,.23,.4,.27,ceramic,0,-.31,0,.085);
  shell(shoulder,.055,.2,.02,sign<0?cyan:violet,sign*.07,-.29,.145,.015);
  const elbow=group(shoulder,`${side}Elbow`,0,-.56,0);
  ball(elbow,.135,metal);cylinder(elbow,.08,.08,.28,pearl,0,-.14,0);
  shell(elbow,.29,.37,.29,ceramic,0,-.28,0,.08);
  const cuff=ring(elbow,.135,.018,sign<0?cyan:pink,0,-.43,0);cuff.rotation.x=Math.PI/2;
  const wrist=group(elbow,`${side}Wrist`,0,-.49,0);
  ball(wrist,.09,metal);shell(wrist,.24,.2,.19,ceramic,0,-.12,.015,.06);
  for(let f=0;f<3;f++){const finger=group(wrist,`${side}Finger${f}`,(f-1)*.075,-.22,.02);shell(finger,.058,.105,.07,pearl,0,-.03,0,.025);shell(finger,.056,.07,.066,ceramic,0,-.11,.013,.02);}
  shell(wrist,.07,.14,.08,pearl,-sign*.15,-.12,.045,.025).rotation.z=-sign*.4;
  const hip=group(pelvis,`${side}Hip`,sign*.28,-.1,0);
  ball(hip,.145,metal);shell(hip,.35,.41,.4,ceramic,0,-.22,0,.09);
  const knee=group(hip,`${side}Knee`,0,-.49,0);
  ball(knee,.135,metal);shell(knee,.24,.18,.12,rubber,0,-.015,.13,.04);
  shell(knee,.32,.39,.35,ceramic,0,-.23,.005,.09);shell(knee,.04,.2,.018,sign<0?cyan:violet,sign*.045,-.23,.19,.01);
  const ankle=group(knee,`${side}Ankle`,0,-.45,0);
  cylinder(ankle,.075,.075,.11,metal,0,-.01,0);
  shell(ankle,.4,.2,.62,ceramic,0,-.09,.13,.08);shell(ankle,.4,.055,.6,rubber,0,-.18,.13,.02);
  shell(ankle,.21,.02,.02,sign<0?cyan:pink,0,-.07,.446,.005);
 }
 const neck=group(torso,'neck',0,1.06,0);cylinder(neck,.14,.17,.19,metal);ring(neck,.15,.02,cyan,0,.04,0).rotation.x=Math.PI/2;
 const head=group(neck,'head',0,.59,0);
 shell(head,1.72,1.27,1.02,ceramic,0,0,0,.23);
 shell(head,1.59,1.17,.2,pearl,0,.01,.49,.2);
 shell(head,1.5,1.09,.07,violet,0,.01,.603,.18);
 shell(head,1.43,1.02,.065,rubber,0,.01,.65,.16);
 shell(head,1.37,.96,.035,cyan,0,.01,.692,.14);
 shell(head,1.32,.91,.045,glass,0,.01,.72,.13);
 // Narrow pink trace on one edge creates an original asymmetric rim accent.
 shell(head,.018,.55,.025,pink,.67,-.02,.747,.006);
 shell(head,.33,.022,.018,whiteGlow,-.32,.46,.739,.005);
 // Physical glass glints, small and restrained rather than a full flat overlay.
 const glint=mat('MeshBasicMaterial',{color:0x7b96bd,transparent:true,opacity:.11,depthWrite:false});
 const reflection=shell(head,.22,.74,.004,glint,-.43,.03,.747,.002);reflection.rotation.z=-.22;
 const face=group(head,'face',0,.05,.761);
 for(const sign of [-1,1]){const eye=group(face,sign<0?'rightEye':'leftEye',sign*.29,.07,0);const pupil=shell(eye,.17,.29,.018,eyeMat,0,0,0,.065);eyes.push(pupil);const brow=shell(face,.2,.025,.012,eyeMat,sign*.29,.285,-.002,.008);joints[sign<0?'rightBrow':'leftBrow']=brow;}
 const mouth=group(face,'mouth',0,-.21,.006);
 const smile=line(mouth,[[-.15,.035,0],[-.08,-.015,0],[0,-.035,0],[.08,-.015,0],[.15,.035,0]],eyeMat,.014);
 const oMouth=ring(mouth,.055,.013,eyeMat,0,0,.003);oMouth.visible=false;
 for(const sign of [-1,1]){
  const ear=group(head,sign<0?'rightEar':'leftEar',sign*.89,0,0);
  cylinder(ear,.245,.245,.14,pearl).rotation.z=Math.PI/2;
  cylinder(ear,.19,.19,.15,rubber,sign*.055,0,0).rotation.z=Math.PI/2;
  ring(ear,.19,.02,sign<0?cyan:pink,sign*.14,0,0).rotation.y=Math.PI/2;
  cylinder(ear,.085,.085,.17,metal,sign*.08,0,0).rotation.z=Math.PI/2;
 }
 const antenna=group(head,'antenna',.47,.65,-.12);cylinder(antenna,.025,.035,.23,metal,0,.09,0);ball(antenna,.067,violet,0,.23,0);ring(antenna,.074,.009,pink,0,.23,0).rotation.x=Math.PI/2;
 // Tiny flush hardware and seam details, using shared geometry/materials.
 for(const x of [-.63,.63])for(const y of [-.42,.42])ball(head,.018,metal,x,y,-.505);
 root.userData.originalDesign='AIVA NOVA procedural geometry';
 const rest=new Map();for(const [name,joint]of Object.entries(joints))rest.set(name,{position:joint.position.clone(),rotation:joint.rotation.clone()});
 return {root,joints,eyes,eyeMat,smile,oMouth,materials,geometryCache,pickables,rest,
  dispose(){const geometries=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.clear();}
 };
}
