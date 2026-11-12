// Compile our original SVGs with the browser's own filter/color implementation.
// No runtime canvas, asset download, third-party image or new dependency.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp'; // Already supplied by Next.js; no added package.
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const quality=[];
try{
 const page=await browser.newPage();
 for(const theme of ['dark','light'])for(const kind of ['mesh','waves'])for(const size of ['','@2x','-mobile']){
  const source=`public/backgrounds/${kind}-${theme}${kind==='waves'&&size==='-mobile'?'-mobile':''}.svg`;
  const output=`public/backgrounds/${kind}-${theme}${size}.webp`;
  const width=size==='@2x'?3200:size==='-mobile'?1200:1600,height=size==='@2x'?1800:size==='-mobile'?2700:900;
  const data=await page.evaluate(async({svg,width,height})=>{const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();const canvas=new OffscreenCanvas(width,height);const context=canvas.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(image,0,0,width,height);const blob=await canvas.convertToBlob({type:'image/png'});return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});},{svg:await readFile(source,'utf8'),width,height});
  const png=Buffer.from(data,'base64'),webp=await sharp(png).webp({lossless:true,effort:6}).toBuffer();
  const original=await sharp(png).ensureAlpha().raw().toBuffer(),decoded=await sharp(webp).ensureAlpha().raw().toBuffer();
  assert.equal(original.length,decoded.length);let transparentRGBChanges=0;
  if(!original.equals(decoded))for(let i=0;i<original.length;i+=4){
   assert.equal(original[i+3],decoded[i+3],`alpha changed in ${output}`);
   const rgbEqual=original[i]===decoded[i]&&original[i+1]===decoded[i+1]&&original[i+2]===decoded[i+2];
   if(original[i+3])assert.ok(rgbEqual,`visible RGB changed in ${output}`);else if(!rgbEqual)transparentRGBChanges++;
  }
  await writeFile(output,webp);quality.push({output,width,height,bytes:webp.length,pngBytes:png.length,visibleRGBAEqual:true,transparentRGBChanges});console.log(`${output}: ${width}x${height}, ${webp.length} bytes, visible RGBA PASS`);
 }
 await mkdir('.npm-cache/stutter',{recursive:true});await writeFile('.npm-cache/stutter/assets-quality.json',JSON.stringify(quality,null,2));
}finally{await browser.close();}
