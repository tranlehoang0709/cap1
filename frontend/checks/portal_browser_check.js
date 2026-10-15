/* DevTools browser check on an already logged-in local AIVA demo session.
 * Visits existing pages/themes and restores the original page/theme. Does not
 * submit forms, change data, read input values or perform authentication.
 */
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('Local AIVA only');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nav = () => Array.from(document.querySelectorAll('[data-testid="stSidebar"] [data-testid="stRadioOption"]'));
  const toggle = () => document.querySelector('.st-key-aiva_theme_switch_scope input');
  const originalPage = nav().find(e => e.querySelector('input')?.checked)?.textContent.trim();
  const originalDark = toggle()?.checked;
  if (!originalPage || !toggle()) throw Error('Open a logged-in Portal first');
  const pages = nav().map(e => e.textContent.trim());
  const results = [];
  const startedAt = new Date().toISOString();
  const themeState = () => {
    const root = getComputedStyle(document.documentElement);
    const style = document.getElementById('aiva-application-theme');
    const scheme = root.colorScheme;
    return {
      toggleDark: toggle()?.checked ?? null,
      declaredScheme: style?.textContent.match(/color-scheme:(light|dark)/)?.[1] ?? null,
      computedScheme: scheme,
      observedDark: scheme === 'dark' ? true : scheme === 'light' ? false : null,
      backgroundToken: root.getPropertyValue('--aiva-bg').trim(),
      surfaceToken: root.getPropertyValue('--aiva-surface').trim(),
      appBackground: document.querySelector('.stApp') ? getComputedStyle(document.querySelector('.stApp')).backgroundColor : null,
      sidebarBackground: document.querySelector('[data-testid="stSidebar"]') ? getComputedStyle(document.querySelector('[data-testid="stSidebar"]')).backgroundColor : null,
    };
  };
  const waitTheme = async dark => {
    const expected = dark ? 'dark' : 'light';
    for (let i = 0; i < 40; i++) {
      const state = themeState();
      if (state.toggleDark === dark && state.declaredScheme === expected && state.computedScheme === expected) {
        await pause(250); return true;
      }
      await pause(200);
    }
    return false;
  };
  const rgb = color => {
    if (color.startsWith('#')) return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    return color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  };
  const luminance = color => rgb(color).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + .05) / (values[0] + .05); };
  const background = element => {
    for (let e = element; e; e = e.parentElement) {
      const color = getComputedStyle(e).backgroundColor;
      if (color.startsWith('rgb(')) return color;
    }
    return null; // Translucent/gradient surfaces require visual verification.
  };
  const visit = async page => {
    const switchingPage = document.querySelector('h1')?.textContent.trim() !== page;
    // Regression trigger: start below the top before a route change. The app,
    // rather than this check, must restore the new route's heading visibility.
    if (switchingPage) document.querySelector('[data-testid="stMain"]')?.scrollTo(0, 200);
    nav().find(e => e.textContent.trim() === page)?.click();
    for (let i = 0; i < 40; i++) {
      await pause(200);
      if (document.querySelector('h1')?.textContent.trim() === page) break;
    }
    // Do not scroll before measurement: that hid navigation/scroll symptoms.
    return switchingPage;
  };
  const snapshot = (page, requestedDark, requireRobotFrame = false) => {
    const header = document.querySelector('.st-key-portal_page_header');
    const rect = header?.getBoundingClientRect();
    const toolbar = document.querySelector('[data-testid="stHeader"]')?.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll(
      '[data-testid="stTextInputField"],[data-testid="stNumberInputField"],textarea,input[role="combobox"],.stButton button,.stFormSubmitButton button,[data-testid="stChatInputSubmitButton"],.sidebar-account strong'));
    const failures = [];
    const theme = themeState();
    const expectedScheme = requestedDark ? 'dark' : 'light';
    if (theme.toggleDark !== requestedDark || theme.declaredScheme !== expectedScheme || theme.computedScheme !== expectedScheme)
      failures.push({kind: 'theme-sync', requestedDark, ...theme});
    const sameColor = (a, b) => a && b && JSON.stringify(rgb(a)) === JSON.stringify(rgb(b));
    if (!sameColor(theme.appBackground, theme.backgroundToken)) failures.push({kind:'app-background', actual:theme.appBackground, expected:theme.backgroundToken});
    if (!sameColor(theme.sidebarBackground, theme.surfaceToken)) failures.push({kind:'sidebar-background', actual:theme.sidebarBackground, expected:theme.surfaceToken});
    let checked = 0;
    let notRendered = 0;
    for (const node of nodes) {
      if (!node.getBoundingClientRect().width || !node.getBoundingClientRect().height) continue;
      // Collapsed details can retain nonzero layout rectangles and a frozen
      // transition value. They are not painted controls; record the omission.
      if (node.checkVisibility && !node.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true, opacityProperty:true})) {
        notRendered++; continue;
      }
      const label = node.querySelector('[data-testid="stMarkdownContainer"] p') || node;
      const fg = getComputedStyle(label).color;
      const bg = background(node);
      if (!bg) continue;
      checked++;
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push({testid: node.dataset.testid, tag: node.tagName, disabled: node.disabled || false, fg, bg, contrast: +ratio.toFixed(2)});
      if (node.matches('input[role="combobox"],[data-testid="stTextInputField"],[data-testid="stNumberInputField"],textarea')) {
        const expected = getComputedStyle(document.documentElement).getPropertyValue(node.disabled ? '--aiva-raised' : '--aiva-surface').trim();
        if (!sameColor(bg, expected)) failures.push({kind:'field-background', testid:node.dataset.testid, actual:bg, expected});
      }
    }
    const chatSurface = document.querySelector('[data-testid="stChatInput"]>div');
    const robots = Array.from(document.querySelectorAll('iframe')).flatMap(frame => {
      try {
        const diagnostics = frame.contentWindow.__AIVA3D__;
        return diagnostics ? [{renderer: diagnostics.rendererInitialized, frames: diagnostics.framesRendered,
          error: diagnostics.lastError, theme: frame.contentDocument.body.className}] : [];
      } catch { return []; }
    });
    for (const robot of robots) {
      robot.status = robot.error ? 'failed' : robot.renderer && robot.frames > 0 ? 'rendered' : 'initializing';
      if (robot.error || robot.status === 'rendered' && !robot.theme.split(/\s+/).includes(expectedScheme) || requireRobotFrame && robot.status !== 'rendered')
        failures.push({kind:'robot', expectedScheme, ...robot});
    }
    const clippingAncestors = [];
    for (let parent = header?.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (['hidden','clip'].includes(css.overflowY) && rect && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1))
        clippingAncestors.push({testid:parent.dataset.testid, overflowY:css.overflowY, top:bounds.top, bottom:bounds.bottom});
    }
    const scrollTop = document.querySelector('[data-testid="stMain"]')?.scrollTop ?? 0;
    if (!rect || clippingAncestors.length || scrollTop === 0 && toolbar && rect.top < toolbar.bottom - 1)
      failures.push({kind:'header-layout', scrollTop, clippingAncestors});
    return {page, requestedDark, observedDark:theme.observedDark, theme, capturedAt:new Date().toISOString(), heading: document.querySelector('h1')?.textContent.trim(),
      stylesheet: !!document.getElementById('aiva-application-theme'), checked, notRendered, failures,
      header: rect ? {top: rect.top, bottom: rect.bottom, scrollTop, clippingAncestors, belowToolbar: !toolbar || rect.top >= toolbar.bottom, visible: rect.top >= 0 && rect.bottom <= innerHeight} : null,
      horizontalOverflow: document.querySelector('[data-testid="stMain"]')?.scrollWidth > innerWidth,
      chatBackground: chatSurface ? getComputedStyle(chatSurface).backgroundColor : null, robots};
  };
  try {
    for (const dark of [false, true]) {
      if (toggle().checked !== dark) toggle().click();
      await waitTheme(dark);
      for (const page of pages) {
        const switchingPage = await visit(page);
        const renderSamples = [];
        for (const delay of [0, 100, 300, 700]) {
          await pause(delay);
          const sample = snapshot(page, dark, delay === 700);
          if (switchingPage && sample.header?.scrollTop !== 0) sample.failures.push({kind:'navigation-scroll', scrollTop:sample.header?.scrollTop});
          renderSamples.push(sample);
        }
        results.push({...renderSamples.at(-1), renderSamples});
      }
    }
  } finally {
    if (toggle()?.checked !== originalDark) toggle()?.click();
    await waitTheme(originalDark);
    await visit(originalPage);
    await pause(800);
  }
  const report = {version:2, startedAt, completedAt:new Date().toISOString(),
    viewport: {width: innerWidth, height: innerHeight, devicePixelRatio}, results,
    restoredState: {page:document.querySelector('h1')?.textContent.trim(), theme:themeState()},
    note:'Historical samples. The page after this run uses restoredState, not the first requestedDark value.'};
  window.__AIVA_PORTAL_CHECK__ = report;
  console.log('[AIVA_PORTAL_CHECK]', JSON.stringify(report));
  console.log('[AIVA_PORTAL_SUMMARY]', JSON.stringify({version:report.version,viewport:report.viewport,restored:report.restoredState,
    results:results.map(r=>({page:r.page,requestedDark:r.requestedDark,observedDark:r.observedDark,
      app:r.theme.appBackground,sidebar:r.theme.sidebarBackground,
      headerTops:r.renderSamples.map(s=>s.header?.top),scroll:r.renderSamples.map(s=>s.header?.scrollTop),
      failures:r.renderSamples.flatMap(s=>s.failures),notRendered:r.notRendered,robots:r.robots}))}));
  return report;
})();
