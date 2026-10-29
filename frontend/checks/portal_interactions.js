/* Local read-only visual audit. Opens tabs, expanders and dropdowns without
 * choosing values or submitting forms. Restores theme, page and opened state. */
(async () => {
  if (!['localhost','127.0.0.1'].includes(location.hostname)) throw Error('Local only');
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const nav = () => [...document.querySelectorAll('[data-testid="stSidebar"] [data-testid="stRadioOption"]')];
  const toggle = () => document.querySelector('.st-key-aiva_theme_switch_scope input');
  const original = {page:nav().find(e=>e.querySelector('input')?.checked)?.textContent.trim(),dark:toggle()?.checked};
  if (!original.page || !toggle()) throw Error('Logged-in Portal required');
  const results=[];
  const bg = e => {for (;e;e=e.parentElement) {const c=getComputedStyle(e).backgroundColor;if(c.startsWith('rgb('))return c;}return null;};
  const lum = c => c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
  const audit = context => {
    const failures=[];let checked=0;
    for (const e of document.querySelectorAll('input[role="combobox"],[data-testid="stNumberInputField"],[data-testid="stTextInputField"],textarea,.stButton button,.stFormSubmitButton button,[role="option"],[role="tab"]')) {
      if (!e.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true,opacityProperty:true}))continue;
      const color=getComputedStyle(e.querySelector('p')||e).color,background=bg(e);if(!background)continue;
      const l=[lum(color),lum(background)].sort((a,b)=>a-b),ratio=(l[1]+.05)/(l[0]+.05);checked++;
      if(ratio<4.5)failures.push({tag:e.tagName,role:e.getAttribute('role'),testid:e.dataset.testid,text:e.matches('input,textarea')?'':e.textContent.trim().slice(0,60),color,background,ratio});
    }
    const options=[...document.querySelectorAll('[role="option"]')].filter(e=>e.checkVisibility({contentVisibilityAuto:true})).length;
    results.push({page:document.querySelector('h1')?.textContent,theme:getComputedStyle(document.documentElement).colorScheme,context,checked,options,failures});
  };
  const visit = async name => {nav().find(e=>e.textContent.trim()===name)?.click();for(let i=0;i<40;i++){await sleep(150);if(document.querySelector('h1')?.textContent===name)break;}await sleep(500);};
  const inspect = async () => {
    const details=[...document.querySelectorAll('[data-testid="stExpander"] details')].filter(e=>!e.open);
    for(const d of details)d.querySelector('summary')?.click();
    await sleep(400);audit('expanded');
    const groups=[...document.querySelectorAll('[data-testid="stTabs"] [role="tablist"]')];
    for(const group of groups){
      const tabs=[...group.querySelectorAll('[role="tab"]')],selected=tabs.find(t=>t.getAttribute('aria-selected')==='true');
      for(const tab of tabs){tab.click();await sleep(350);audit('tab:'+tab.textContent.trim());
        for(const combo of document.querySelectorAll('input[role="combobox"]:not(:disabled)')){
          if(!combo.checkVisibility({contentVisibilityAuto:true}))continue;
          const button=combo.closest('[role="group"]')?.querySelector('button');
          button?.click();await sleep(150);
          audit('dropdown:'+combo.getAttribute('aria-label'));
          if(combo.getAttribute('aria-expanded')==='true')button?.click();
        }
      }
      selected?.click();await sleep(150);
    }
    // Pages without tabs still contain selectboxes.
    if(!groups.length)for(const combo of document.querySelectorAll('input[role="combobox"]:not(:disabled)')){
      if(!combo.checkVisibility({contentVisibilityAuto:true}))continue;
      const button=combo.closest('[role="group"]')?.querySelector('button');button?.click();await sleep(150);audit('dropdown');
      if(combo.getAttribute('aria-expanded')==='true')button?.click();
    }
    for(const d of details)if(d.isConnected&&d.open)d.querySelector('summary')?.click();
  };
  try {for(const dark of [false,true]){
    if(toggle().checked!==dark)toggle().click();await sleep(1000);
    for(const name of nav().map(e=>e.textContent.trim())){await visit(name);await inspect();}
  }} finally {if(toggle()?.checked!==original.dark)toggle()?.click();await sleep(800);await visit(original.page);}
  window.__AIVA_INTERACTIONS__={viewport:{width:innerWidth,height:innerHeight},results};
  console.log('[AIVA_INTERACTIONS]',JSON.stringify(window.__AIVA_INTERACTIONS__));
})();
