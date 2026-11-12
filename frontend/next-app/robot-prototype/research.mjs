// Public browser observation only. No source/model/texture/audio is reused.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('../node_modules/@playwright/test');
await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const requests=[];page.on('request',r=>requests.push(r.url()));
try{
 await page.goto('https://rafaelcodex.com/',{waitUntil:'networkidle',timeout:60000});
 const info=await page.evaluate(()=>{
  const source=[...document.scripts].map(s=>s.textContent).join('\n');
  const terms=['THREE','WebGLRenderer','GLTFLoader','GLB','react-three','MeshPhysicalMaterial','MeshStandardMaterial','BoxGeometry','SphereGeometry','CapsuleGeometry','AudioContext','Oscillator','Raycaster','head','arm','leg','eye','saludar','bailar','celebrar'];
  const names=['createArmAssembly','createLegAssembly','playWaveAnimation','playDanceAnimation','playCelebrateAnimation','playClickReactionAnimation','animate'];
  const structure=Object.fromEntries(names.map(name=>{const start=source.indexOf('function '+name+'(');if(start<0)return[name,null];let depth=0,end=source.indexOf('{',start);const begin=end;do{const c=source[end++];if(c==='{')depth++;else if(c==='}')depth--;}while(depth&&end<source.length);const code=source.slice(begin,end);return[name,{objects:[...new Set([...code.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*new THREE\.(\w+)/g)].map(m=>m[1]+':'+m[2]))],animatedProperties:[...new Set([...code.matchAll(/([\w.]+)\.(rotation|position|scale)/g)].map(m=>m[1]+'.'+m[2]))],gsap:code.includes('gsap'),durationValues:[...code.matchAll(/duration\s*:\s*([\d.]+)/g)].map(m=>m[1])}];}));
  return {title:document.title,structure,scripts:[...document.scripts].map(s=>({src:s.src,type:s.type,length:s.textContent.length})),canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),terms:Object.fromEntries(terms.map(t=>[t,(source.match(new RegExp(t,'gi'))||[]).length])),buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),onclick:b.getAttribute('onclick')})),functions:[...source.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)].map(m=>m[1]),resources:performance.getEntriesByType('resource').map(r=>r.name)};
 });
 console.log(JSON.stringify(info,null,2));
 await page.screenshot({path:new URL('./artifacts/reference.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:false});
 for(const label of ['SALUDAR','BAILAR','CELEBRAR','SFX']){const button=page.getByRole('button',{name:new RegExp(label)}).first();if(await button.count()){await button.click();await page.waitForTimeout(600);console.log('AFTER',label,await button.innerText());}}
 await writeFile(new URL('./artifacts/reference-observation.json',import.meta.url),JSON.stringify({...info,requests},null,2));
}finally{await browser.close();}
