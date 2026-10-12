"""Self-contained interactive robot scene. No CDN, network or backend calls."""
import streamlit as st
from ui.robot import ROBOT


def render_robot_scene(*, hero=False, online=True):
    mode = 'hero' if hero else 'card'
    state = 'online' if online else 'offline'
    markup = ROBOT.replace('class="robot"', f'class="robot {state}"')
    document = '''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;background:transparent;color:#dcecff;font-family:system-ui,sans-serif}
.scene{height:HEIGHTpx;position:relative;overflow:hidden;border:1px solid #375879;border-radius:18px;background:radial-gradient(ellipse at 50% 65%,#173757,#0a1425 75%);perspective:850px;touch-action:pan-y}
canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.holo{position:absolute;inset:12px;border-radius:14px;transform-style:preserve-3d;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .18s ease-out;background:radial-gradient(circle at var(--mx,50%) var(--my,40%),#55dcff28,transparent 55%);border:1px solid #658cc82a}
.holo::before{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(120deg,transparent 15%,#6577ff16 30%,#6fffe92b 48%,#b77aff26 65%,transparent 85%);opacity:var(--shine,.3);pointer-events:none;mix-blend-mode:screen}
.holo::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 22px #6e79ff22;pointer-events:none}
.robot{height:100%;display:grid;place-items:center;position:relative;transform:translateZ(32px)}
.robot>svg{height:72%;max-width:70%;overflow:visible;filter:drop-shadow(0 15px 10px #0008);transform:translate3d(var(--lookx,0px),var(--looky,0px),18px)}
.robot-body{animation:float 4.8s ease-in-out infinite}.robot-ground{opacity:.5}
.robot-eye{transform:translate(var(--eyex,0px),var(--eyey,0px));filter:drop-shadow(0 0 3px #45d5ff)}
.robot-core{animation:pulse 2s ease-in-out infinite}.robot-arm{transform-origin:125px 96px;animation:wave 2s ease-in-out .5s 2}
.scene:hover .robot-arm{animation:wave 2s ease-in-out infinite}
.face-scan{animation:scan 4s ease-in-out infinite}
.holo-stage{position:absolute;inset:0;pointer-events:none}.holo-platform{position:absolute;bottom:13%;left:50%;width:58%;max-width:245px;height:45px;transform:translateX(-50%);border-radius:50%;background:#54cfff15;box-shadow:0 0 35px #399cff33}
.holo-platform i{position:absolute;inset:0;border:1px solid #59d5ff88;border-radius:50%}.holo-platform i:nth-child(2){inset:7px 20px;border:2px dashed #9c87ff;animation:spin 16s linear infinite}.holo-platform i:nth-child(3){animation:ring 3s ease-out infinite}
.holo-beam{position:absolute;bottom:15%;left:30%;width:40%;height:60%;background:linear-gradient(0deg,#59d4ff22,transparent);clip-path:polygon(30% 0,70% 0,100% 100%,0 100%)}
.holo-grid{position:absolute;inset:50% -50% -45%;background-image:linear-gradient(#4bbaff22 1px,transparent 1px),linear-gradient(90deg,#4bbaff22 1px,transparent 1px);background-size:30px 30px;transform:perspective(220px) rotateX(55deg);mask-image:radial-gradient(ellipse,#000,transparent 65%);animation:grid 8s linear infinite}
.holo-particle,.holo-label{display:none}.caption{position:absolute;bottom:18px;width:100%;text-align:center;font:10px monospace;letter-spacing:2px;color:#89b3d4;pointer-events:none}
.badge{position:absolute;top:20px;left:22px;font:10px monospace;letter-spacing:2px;color:#8dc7e6}.badge::before{content:"";display:inline-block;width:6px;height:6px;background:#66e9ce;border-radius:50%;margin-right:8px;box-shadow:0 0 9px #66e9ce}
.card .badge{display:none}.card .caption{font-size:9px;bottom:12px}.offline .robot-body,.offline .robot-arm,.offline .robot-core,.offline .face-scan{animation:none!important}.offline .robot-eye,.offline .robot-core{opacity:.3;filter:none}.scene.is-offline .holo-platform{opacity:.3}.scene.is-offline .holo-platform i,.scene.is-offline .holo-grid{animation:none}.scene.is-offline .holo-beam{display:none}
@keyframes float{50%{transform:translateY(-10px)}}@keyframes pulse{50%{filter:drop-shadow(0 0 5px #50dfff)}}@keyframes wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-125deg)}40%,80%{transform:rotate(-100deg)}}@keyframes scan{0%,100%{opacity:0}30%{opacity:.5}70%{transform:translateY(25px);opacity:0}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes ring{0%{transform:scale(.8);opacity:.7}100%{transform:scale(1.4);opacity:0}}@keyframes grid{to{background-position:0 30px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.holo{transform:none}.face-scan{display:none}}
</style><div class="scene MODE OFFLINE"><canvas aria-hidden="true"></canvas><div class="holo">ROBOT</div><div class="badge">AIVA / INTERACTIVE CORE</div><div class="caption">CAPTION</div></div>
<script>
(()=>{
const scene=document.querySelector('.scene'),holo=document.querySelector('.holo'),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let w=0,h=0,frame=0,last=0,visible=true,particles=[];const mouse={x:0,y:0,active:false};
const hero=scene.classList.contains('hero'),online=!scene.classList.contains('is-offline');
function reset(){mouse.active=false;for(const [k,v] of Object.entries({'--rx':'0deg','--ry':'0deg','--eyex':'0px','--eyey':'0px','--lookx':'0px','--looky':'0px','--shine':'.3','--mx':'50%','--my':'40%'}))holo.style.setProperty(k,v)}
scene.addEventListener('pointermove',e=>{if(reduced.matches)return;const b=scene.getBoundingClientRect(),x=(e.clientX-b.left)/b.width,y=(e.clientY-b.top)/b.height;mouse.x=x*w;mouse.y=y*h;mouse.active=true;holo.style.setProperty('--rx',`${(0.5-y)*12}deg`);holo.style.setProperty('--ry',`${(x-0.5)*20}deg`);holo.style.setProperty('--mx',`${x*100}%`);holo.style.setProperty('--my',`${y*100}%`);holo.style.setProperty('--shine','.85');if(online){holo.style.setProperty('--eyex',`${(x-.5)*7}px`);holo.style.setProperty('--eyey',`${(y-.5)*5}px`);holo.style.setProperty('--lookx',`${(x-.5)*5}px`);holo.style.setProperty('--looky',`${(y-.5)*3}px`)}});
scene.addEventListener('pointerleave',reset);scene.addEventListener('pointercancel',reset);
function resize(){const b=scene.getBoundingClientRect();w=b.width;h=b.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);particles=Array.from({length:hero?65:18},()=>({x:Math.random()*w,y:Math.random()*h,v:.15+Math.random()*.35,r:.6+Math.random()*1.2,phase:Math.random()*6.28}));draw(0)}
function draw(time){ctx.clearRect(0,0,w,h);if(!online)return;for(let i=0;i<particles.length;i++){const p=particles[i];if(!reduced.matches){p.y-=p.v;p.x+=Math.sin(time*.0003+p.phase)*.12;if(p.y<0)p.y=h;if(mouse.active){const dx=p.x-mouse.x,dy=p.y-mouse.y,dist=Math.hypot(dx,dy);if(dist>0&&dist<70){p.x+=dx/dist*.8;p.y+=dy/dist*.8}}p.x=(p.x+w)%w}ctx.fillStyle=`rgba(112,197,255,${.25+Math.sin(time*.001+p.phase)*.15})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();if(hero)for(let j=i+1;j<particles.length;j++){const q=particles[j],dist=Math.hypot(p.x-q.x,p.y-q.y);if(dist<65){ctx.strokeStyle=`rgba(104,129,255,${(1-dist/65)*.12})`;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}}}}
function tick(time){frame=0;if(!visible||document.hidden||reduced.matches||!online)return;if(time-last>32){draw(time);last=time}frame=requestAnimationFrame(tick)}
function sync(){cancelAnimationFrame(frame);frame=0;if(visible&&!document.hidden&&!reduced.matches&&online)frame=requestAnimationFrame(tick);else draw(0)}
new ResizeObserver(resize).observe(scene);new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync()}).observe(scene);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',()=>{reset();sync()});resize();sync();
})();
</script></html>'''
    document = document.replace('HEIGHT', str(390 if hero else 250)).replace('MODE', mode).replace('OFFLINE', '' if online else 'is-offline').replace('ROBOT', markup).replace('CAPTION', 'Rê chuột để tương tác với AIVA' if hero else ('XIAOZHI / ONLINE' if online else 'XIAOZHI / OFFLINE'))
    st.iframe(document, height=392 if hero else 252, tab_index=-1, alt="Robot AIVA và nền hologram tương tác")
