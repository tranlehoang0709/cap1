// Streamlit keeps stMain's scroll position across radio-route changes/login.
// Observe the existing heading; reset only on entry or a different page.
// Same-page form/theme reruns retain scroll, and only one observer is installed.
(() => {
  const key = '__aivaHeaderScroll';
  const main = document.querySelector('[data-testid="stMain"]');
  if (!main) return;
  if (window[key]?.main === main) { window[key].schedule(); return; }
  window[key]?.dispose();
  let previousPage = null;
  let pending = 0;
  const sync = () => {
    pending = 0;
    const heading = main.querySelector('.st-key-portal_page_header h1');
    const page = heading?.textContent.trim();
    // A streaming rerun can briefly remove the heading. Clear the route only
    // when the login header is present, not during that temporary gap.
    if (!page) {
      if (main.querySelector('.st-key-login_header')) previousPage = null;
      return;
    }
    if (page !== previousPage) {
      previousPage = page;
      main.scrollTo({top: 0, left: main.scrollLeft, behavior: 'instant'});
    }
  };
  const schedule = () => { if (!pending) pending = requestAnimationFrame(sync); };
  const observer = new MutationObserver(schedule);
  observer.observe(main, {childList: true, subtree: true, characterData: true});
  const dispose = () => {
    observer.disconnect();
    if (pending) cancelAnimationFrame(pending);
    window.removeEventListener('pagehide', dispose);
    if (window[key]?.main === main) delete window[key];
  };
  window[key] = {main, schedule, dispose};
  window.addEventListener('pagehide', dispose, {once: true});
  schedule();
})();
