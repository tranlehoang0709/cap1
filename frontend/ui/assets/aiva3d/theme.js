const palettes = {
  dark: {ground: 0x0a192c, ring: 0x36bcd9, ringOpacity: 0.45,
    particle: 0x63d5ef, particleOpacity: 0.4, offlineOpacity: 0.08,
    hemisphere: 1.8, key: 3, rim: 2.1, fill: 1.2, environment: 0.7, exposure: 1.05},
  light: {ground: 0xdce8f5, ring: 0x4aa5c7, ringOpacity: 0.32,
    particle: 0x4484ae, particleOpacity: 0.58, offlineOpacity: 0.16,
    hemisphere: 1.4, key: 2.7, rim: 0.9, fill: 1.1, environment: 0.65, exposure: 0.95},
};

export function applySceneTheme(scene, renderer, light, online) {
  const palette = palettes[light ? 'light' : 'dark'];
  scene.getObjectByName('holo-floor').material.color.setHex(palette.ground);
  scene.traverse(item => {
    if (item.name === 'holo-ring') {
      item.material.color.setHex(online ? palette.ring : light ? 0x8aa9bb : 0x31516b);
      item.material.opacity = palette.ringOpacity;
    }
  });
  const particles = scene.getObjectByName('atmosphere');
  particles.material.color.setHex(palette.particle);
  particles.material.opacity = online ? palette.particleOpacity : palette.offlineOpacity;
  for (const name of ['hemisphere', 'key', 'rim', 'fill']) {
    scene.getObjectByName(`theme-${name}`).intensity = palette[name];
  }
  scene.environmentIntensity = palette.environment;
  renderer.toneMappingExposure = palette.exposure;
}

export function watchParentTheme(onTheme, host = window) {
  // st.iframe srcdoc permits same-origin access. apply_theme() already writes
  // root color-scheme from the existing Streamlit appearance state.
  const parent = host.parent;
  const document = parent.document;
  let current, pending = false, closed = false;
  function sync() {
    pending = false;
    if (closed) return;
    const light = parent.getComputedStyle(document.documentElement).colorScheme === 'light';
    if (light !== current) { current = light; onTheme(light); }
  }
  function styleNode(node) {
    return node.nodeName === 'STYLE' || !!node.querySelector?.('style');
  }
  const observer = new host.MutationObserver(records => {
    const changed = records.some(record => record.target.nodeName === 'STYLE' ||
      record.target.parentNode?.nodeName === 'STYLE' ||
      record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(styleNode) ||
      record.type === 'attributes' && record.target === document.documentElement);
    if (changed && !pending) { pending = true; host.queueMicrotask(sync); }
  });
  observer.observe(document.documentElement, {childList: true, subtree: true,
    characterData: true, attributes: true, attributeFilter: ['style', 'class']});
  sync();
  return () => { closed = true; observer.disconnect(); };
}
