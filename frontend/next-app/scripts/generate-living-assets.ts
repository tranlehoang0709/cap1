// Original AIVA geometry, same palette/filter values as the approved inline SVG.
// Run with the existing tsx CLI. Assets are vectors, not screenshots/background PNGs.
import {mkdir,writeFile} from 'node:fs/promises';
import {FLOW_PATHS,createDigitalMesh} from '../src/components/backgrounds/living-geometry';
async function main(){
await mkdir('public/backgrounds',{recursive:true});
const svg=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" preserveAspectRatio="none">${body}</svg>`;
for(const light of [false,true]){
 const theme=light?'light':'dark',cyan=light?'#379cc0':'#63dbe9',violet=light?'#9183c9':'#8a82f0',pink=light?'#b6a1d3':'#c19ce5';
 await writeFile(`public/backgrounds/mesh-${theme}.svg`,svg(`<g fill="${light?'#7d9abb':'#75a9d2'}">${createDigitalMesh().map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${p.r}" opacity="${p.opacity}"/>`).join('')}</g>`));
 for(const mobile of [false,true]){
  const paths=FLOW_PATHS.map(d=>`<path d="${d}"/>`).join('');
  const defs='<defs>'+`<linearGradient id="flow" x1="0" x2="1"><stop offset="0%" stop-color="${cyan}" stop-opacity=".1"/><stop offset="22%" stop-color="${cyan}"/><stop offset="62%" stop-color="${violet}"/><stop offset="88%" stop-color="${pink}" stop-opacity=".7"/><stop offset="100%" stop-color="${pink}" stop-opacity="0"/></linearGradient>`+'<filter id="haze" x="-10%" y="-25%" width="120%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12"/></filter><filter id="glow" x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter></defs>';
  const body=defs+`<g fill="none" stroke="url(#flow)" stroke-linecap="round">`+(mobile?'':`<g opacity="${light?.12:.22}" stroke-width="12" filter="url(#haze)">${paths}</g>`)+`<g opacity="${(light?.20:.42)*(mobile?.65:1)}" stroke-width="3.5" filter="url(#glow)">${paths}</g><g opacity="${light?.40:.74}" stroke-width=".85">${paths}</g>`+(mobile?'':'<path opacity=".18" d="M320-80C540 40 670 155 880 60S1130-60 1250-100" stroke-width="1.2"/>')+'</g>';
  await writeFile(`public/backgrounds/waves-${theme}${mobile?'-mobile':''}.svg`,svg(body));
 }
}
console.log('Generated 6 original AIVA vector assets; geometry and filters preserved.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
