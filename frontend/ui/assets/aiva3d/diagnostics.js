// Runs before the bundle, so parse/import/bootstrap errors are also visible.
(() => {
  const diagnostics = window.__AIVA3D__ = {
    bundleLoaded: false, threeRevision: null, phase: 'bundle', webgl2: null,
    rendererInitialized: false, framesRendered: 0, drawCalls: 0, lastError: null,
  };
  window.__AIVA3DReportError = (error, phase = diagnostics.phase) => {
    const message = error?.message || String(error);
    const kind = phase === 'webgl2-context' || phase === 'context-lost' ? 'WebGL' :
      phase === 'bundle' ? 'bundle' : phase === 'renderer' ? 'renderer' :
      phase === 'shader' ? 'shader' : 'JavaScript';
    diagnostics.lastError = {kind, phase, message, stack: error?.stack || null};
    diagnostics.phase = 'failed';
    const status = document.getElementById('status');
    status.textContent = kind === 'WebGL' ? `Bản SVG dự phòng: lỗi ${phase}: ${message}` :
      `Bản SVG dự phòng: lỗi ${kind} (${phase}): ${message}`;
    document.getElementById('stage').classList.remove('ready');
    document.getElementById('fallback').hidden = false;
    for (const id of ['pause', 'wave', 'reset']) document.getElementById(id).disabled = true;
    console.error('[AIVA3D]', diagnostics.lastError, error);
  };
  const handle = error => (window.__AIVA3DHandleError || window.__AIVA3DReportError)(error);
  window.addEventListener('error', event => handle(event.error || new Error(event.message)));
  window.addEventListener('unhandledrejection', event => handle(event.reason));
})();
