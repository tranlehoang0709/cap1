/* Run from Chrome Console on local AI Chat. Uses existing theme control only. */
(async () => {
  if (!['localhost','127.0.0.1'].includes(location.hostname)) throw Error('Local only');
  const toggle=()=>document.querySelector('.st-key-aiva_theme_switch_scope input');
  const original=toggle()?.checked,results=[];
  if(!document.querySelector('.st-key-chat_workspace'))throw Error('Open AI Chat');
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  try {for(const dark of [false,true]){
    if(toggle().checked!==dark)toggle().click();await pause(1200);
    const workspace=document.querySelector('.st-key-chat_workspace');
    const row=[...workspace.querySelectorAll('[data-testid="stHorizontalBlock"]')].find(e=>e.querySelector('.st-key-chat_history'));
    const history=document.querySelector('.st-key-chat_history'),main=document.querySelector('.st-key-chat_main');
    const w=workspace.getBoundingClientRect(),h=history.getBoundingClientRect(),m=main.getBoundingClientRect();
    const direction=getComputedStyle(row).flexDirection,scheme=getComputedStyle(document.documentElement).colorScheme;
    const failures=[];
    if(direction!==(w.width<=700?'column':'row'))failures.push('incorrect-column-layout');
    if(h.width<160)failures.push('history-too-narrow');
    if(h.right>w.right+1||m.right>w.right+1)failures.push('horizontal-overflow');
    if(scheme!==(dark?'dark':'light'))failures.push('theme');
    results.push({dark,scheme,workspace:w.width,history:h.width,main:m.width,direction,failures});
  }}finally{if(toggle()?.checked!==original)toggle()?.click();await pause(800);}
  window.__AIVA_CHAT_LAYOUT__={viewport:{width:innerWidth,height:innerHeight},results};
  console.log('[AIVA_CHAT_LAYOUT]',JSON.stringify(window.__AIVA_CHAT_LAYOUT__));
})();
