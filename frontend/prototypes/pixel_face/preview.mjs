import {EXPRESSIONS} from './registry.mjs';
import {ExpressionController} from './controller.mjs';
import {PixelFaceRenderer} from './renderer.mjs';

const canvas=document.getElementById('face');
const controller=new ExpressionController();
const renderer=new PixelFaceRenderer(canvas);
const buttons=document.querySelectorAll('[data-expression]');
const play=document.getElementById('play');
const reducedInput=document.getElementById('reduce-motion');
const media=matchMedia('(prefers-reduced-motion: reduce)');
let frame=0,last=0,inViewport=true,disposed=false;
const abort=new AbortController();

function render(){renderer.render(controller.state,{motion:controller.moving});}
function stop(){cancelAnimationFrame(frame);frame=0;last=0;}
function tick(now){
  frame=0;
  if(!controller.moving||disposed)return;
  controller.update(last?(now-last)/1000:0);last=now;
  render();frame=requestAnimationFrame(tick);
}
function sync(){
  stop();
  controller.setVisible(inViewport&&!document.hidden);
  controller.setReducedMotion(media.matches||reducedInput.checked);
  document.getElementById('motion-status').textContent=controller.reducedMotion?'Giảm chuyển động':controller.paused?'Đã tạm dừng':controller.visible?'Đang chuyển động':'Đang nghỉ';
  play.textContent=controller.paused?'Tiếp tục':'Tạm dừng';
  play.setAttribute('aria-pressed',String(controller.paused));
  render();if(controller.moving&&!disposed)frame=requestAnimationFrame(tick);
}
function choose(id){
  if(!controller.setExpression(id))return false;
  const preset=EXPRESSIONS[id];
  for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.expression===id));
  document.getElementById('expression-label').textContent=preset.label;
  document.getElementById('expression-description').textContent=preset.subtitle;
  canvas.setAttribute('aria-label',`Khuôn mặt LED: ${preset.label}`);
  sync();return true;
}
for(const b of buttons)b.addEventListener('click',()=>choose(b.dataset.expression),{signal:abort.signal});
play.addEventListener('click',()=>{controller.setPaused(!controller.paused);sync();},{signal:abort.signal});
reducedInput.addEventListener('change',sync,{signal:abort.signal});
media.addEventListener('change',sync,{signal:abort.signal});
document.addEventListener('visibilitychange',sync,{signal:abort.signal});
const observer=new IntersectionObserver(([entry])=>{inViewport=entry.isIntersecting;sync();},{threshold:0.1});
observer.observe(canvas);
window.addEventListener('pagehide',event=>{
  stop();
  if(!event.persisted){disposed=true;observer.disconnect();abort.abort();}
},{signal:abort.signal});
window.addEventListener('pageshow',sync,{signal:abort.signal});
sync();
