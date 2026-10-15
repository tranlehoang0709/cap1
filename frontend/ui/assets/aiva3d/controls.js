import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createControls(camera, canvas, target) {
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  // Direct, smooth pointer deltas; paused scenes need no damping RAF loop.
  controls.enableDamping = false;
  controls.minPolarAngle = Math.PI * 0.28;
  controls.maxPolarAngle = Math.PI * 0.66;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.65;
  controls.target.copy(target);
  return controls;
}

export function bindControlRender(controls, render, onError, shouldRender = () => true) {
  const change = () => {
    if (!shouldRender()) return;
    // OrbitControls dispatches change BEFORE committing its last camera pose.
    // Calling update() in this listener re-enters change indefinitely.
    try { render(false); } catch (error) { onError(error); }
  };
  controls.addEventListener('change', change);
  return () => controls.removeEventListener('change', change);
}
