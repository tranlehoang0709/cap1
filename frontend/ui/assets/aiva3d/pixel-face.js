import * as THREE from 'three';
import {ExpressionController} from '../../../prototypes/pixel_face/controller.mjs';
import {PixelFaceRenderer} from '../../../prototypes/pixel_face/renderer.mjs';
import {EXPRESSION_IDS} from '../../../prototypes/pixel_face/registry.mjs';

export {EXPRESSION_IDS};

// Adapter chỉ quản lý bề mặt mặt LED; không có loop, camera hoặc lệnh mạng.
export function createPixelFace(robot, {createCanvas=()=>document.createElement('canvas')}={}) {
  const controller=new ExpressionController();
  const canvas=createCanvas();
  const painter=new PixelFaceRenderer(canvas,{width:128,height:64});
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=texture.magFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;
  const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.48,0.74),material);
  mesh.name='pixel-led-face';
  mesh.position.set(0,-0.01,0.80);
  robot.head.add(mesh);
  let id='neutral',dirty=true,disposed=false,lastOnline;
  const legacy=[...robot.eyes,robot.mouth];
  legacy.forEach(item=>{item.visible=false;});
  return {
    mesh,texture,canvas,controller,
    get id(){return id;},
    setExpression(next){
      if(disposed || (!EXPRESSION_IDS.includes(next)&&next!=='excited'))return false;
      id=next;
      const oldFace=next==='excited';
      mesh.visible=!oldFace;
      legacy.forEach(item=>{item.visible=oldFace;});
      if(!oldFace)controller.setExpression(next);
      dirty=true;
      return true;
    },
    update(delta,{moving=true,online=true,reducedMotion=false}={}){
      if(disposed)return;
      controller.setPaused(!moving);
      // Ép pose tĩnh khi giảm chuyển động hoặc offline; không giả lập trạng thái AI.
      if(controller.reducedMotion!==Boolean(reducedMotion||!online)){
        controller.setReducedMotion(reducedMotion||!online);dirty=true;
      }
      if(lastOnline!==online){material.color.setHex(online?0xffffff:0x34515b);lastOnline=online;dirty=true;}
      if(id==='excited')return;
      const state=controller.update(delta);
      if(moving||dirty){
        painter.render(state,{motion:moving&&online&&!reducedMotion});
        texture.needsUpdate=true;dirty=false;
      }
    },
    dispose(){
      if(disposed)return;
      disposed=true;mesh.removeFromParent();
      texture.dispose();mesh.geometry.dispose();material.dispose();
      legacy.forEach(item=>{item.visible=true;});
    },
  };
}
