/* Existing local demo conversation only; opens menu, never submits/actions. */
(async()=>{
  if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Local only');
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const toggle=()=>document.querySelector('.st-key-aiva_theme_switch_scope input');
  const original=toggle().checked,results=[];
  const lum=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
  const bg=e=>{for(;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(c.startsWith('rgb('))return c;}return null;};
  try{for(const dark of [false,true]){
    if(toggle().checked!==dark)toggle().click();await pause(1000);
    const trigger=document.querySelector('[data-testid="stPopoverButton"]');
    if(!trigger)throw Error('Open an existing conversation first');
    trigger.click();await pause(400);
    const body=document.querySelector('[data-testid="stPopoverBody"]');
    const failures=[],controls=[];
    if(!body)failures.push('popover-not-open');
    for(const e of document.querySelectorAll('[data-testid="stPopoverBody"] input,[data-testid="stPopoverBody"] button,.st-key-chat_main input:disabled,.st-key-chat_main textarea:disabled,.st-key-chat_main button:disabled')){
      if(!e.checkVisibility({contentVisibilityAuto:true}))continue;
      const color=getComputedStyle(e.querySelector('p')||e).color,background=bg(e);if(!background)continue;
      const l=[lum(color),lum(background)].sort((a,b)=>a-b),ratio=(l[1]+.05)/(l[0]+.05);
      controls.push({tag:e.tagName,disabled:e.disabled,color,background,contrast:ratio});
      if(ratio<4.5)failures.push({tag:e.tagName,color,background,ratio});
    }
    results.push({dark,theme:getComputedStyle(document.documentElement).colorScheme,popover:!!body,controls,failures});
    if(body)trigger.click();await pause(150);
  }}finally{if(toggle().checked!==original)toggle().click();await pause(800);}
  console.log('[AIVA_POPOVER]',JSON.stringify({results}));
})();
