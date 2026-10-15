import * as THREE from 'three';
import { createControls, bindControlRender } from './controls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRobot, animateRobot, fitDistance, disposeScene } from './model.js';
import { applySceneTheme, watchParentTheme } from './theme.js';

const diagnostics = window.__AIVA3D__;
diagnostics.bundleLoaded = true;
diagnostics.threeRevision = THREE.REVISION;
diagnostics.phase = 'bootstrap';
const config = JSON.parse(document.getElementById('aiva-config').textContent);
const stage = document.getElementById('stage');
const mount = document.getElementById('viewport');
const fallback = document.getElementById('fallback');
const status = document.getElementById('status');
const pauseButton = document.getElementById('pause');
const waveButton = document.getElementById('wave');
const resetButton = document.getElementById('reset');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const abort = new AbortController();
diagnostics.phase = 'waiting-visible';
let renderer, scene, camera, controls, robot, environment;
let visible = false, destroyed = false, failed = false, localPaused = false;
let frame = 0, last = 0, clock = 1.2, waveStart = -Infinity, interacting = false;
let resizeObserver, intersectionObserver, down = null;
let canvasAbort, releaseTimer = 0, savedView = null;
let unbindControlRender;
let lightTheme = false, stopWatchingTheme;
let defaultDistance = 10;
const direction = new THREE.Vector3(0.12, 0.025, 1).normalize();
function listen(target, type, fn, options = {}) {
  target.addEventListener(type, fn, {...options, signal: abort.signal});
}
function listenCanvas(type, fn) {
  renderer.domElement.addEventListener(type, fn, {signal: canvasAbort.signal});
}
function moving() { return config.online && !config.paused && !localPaused && !reduced.matches; }
function active() { return visible && !document.hidden && !destroyed && !failed; }
function message() {
  if (failed || destroyed) return;
  status.textContent = !config.online ? 'Offline' :
    reduced.matches ? 'Giảm chuyển động' : config.paused || localPaused ? 'Đã tạm dừng' : 'Online';
  pauseButton.textContent = localPaused || config.paused ? 'Tiếp tục' : 'Dừng';
  pauseButton.setAttribute('aria-pressed', String(localPaused || config.paused));
  // Global Streamlit pause cannot be overridden by the local component.
  pauseButton.disabled = config.paused || reduced.matches || !config.online;
  waveButton.disabled = !moving();
}
function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; }
function fail(error, phase = diagnostics.phase) {
  if (failed || destroyed) return;
  failed = true;
  stop();
  clearTimeout(releaseTimer);
  window.__AIVA3DReportError(error, phase);
  try { releaseGPU(); } catch (cleanupError) { console.warn('[AIVA3D] Cleanup error', cleanupError); }
}
window.__AIVA3DHandleError = error => fail(error);
function releaseGPU() {
  if (renderer && camera && controls) {
    savedView = {offset: camera.position.clone().sub(controls.target), distance: defaultDistance};
  }
  canvasAbort?.abort();
  unbindControlRender?.();
  unbindControlRender = null;
  controls?.dispose();
  if (scene) disposeScene(scene);
  environment?.dispose();
  if (renderer) {
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  renderer = scene = controls = robot = environment = null;
}
function dispose() {
  if (destroyed) return;
  destroyed = true;
  stop();
  clearTimeout(releaseTimer);
  abort.abort();
  stopWatchingTheme?.();
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
  releaseGPU();
}
function addEnvironment() {
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.7;
  } finally { room.dispose(); pmrem.dispose(); }
  const hemisphere = new THREE.HemisphereLight(0xd9efff, 0x163350, 1.8);
  hemisphere.name = 'theme-hemisphere';
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xf6f9ff, 3.0);
  key.name = 'theme-key';
  key.position.set(-3, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(config.hero ? 1024 : 512);
  Object.assign(key.shadow.camera, {left: -3, right: 3, top: 5, bottom: -2, near: 0.5, far: 16});
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x54cfff, 2.1);
  rim.name = 'theme-rim';
  rim.position.set(3, 3, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xa3bbff, 1.2);
  fill.name = 'theme-fill';
  fill.position.set(3, 2, 4);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshStandardMaterial({color: 0x0a192c, roughness: 0.82, metalness: 0.25}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.015;
  ground.receiveShadow = true;
  ground.name = 'holo-floor';
  scene.add(ground);
  for (const radius of [1.2, 1.5]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.013, 6, 64),
      new THREE.MeshBasicMaterial({color: config.online ? 0x36bcd9 : 0x31516b,
        transparent: true, opacity: 0.45, depthWrite: false}));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    ring.name = 'holo-ring';
    scene.add(ring);
  }
  const positions = new Float32Array((config.hero ? 38 : 14) * 3);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (Math.random() - 0.5) * 6;
    positions[i + 1] = Math.random() * 4.5;
    positions[i + 2] = (Math.random() - 0.5) * 4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x63d5ef, size: 0.022, transparent: true,
    opacity: config.online ? 0.4 : 0.08, depthWrite: false,
  }));
  particles.name = 'atmosphere';
  scene.add(particles);
  applySceneTheme(scene, renderer, lightTheme, config.online);
}
function resize() {
  if (!renderer || destroyed || failed) return;
  const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
  const previous = defaultDistance;
  const zoomRatio = camera.position.distanceTo(controls.target) / previous;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, config.hero ? 1.75 : 1.25));
  renderer.setSize(width, height, false);
  defaultDistance = fitDistance(robot.radius, camera.aspect, camera.fov);
  // Even the closest zoom fits the full animated bounding sphere.
  controls.minDistance = defaultDistance / 1.06;
  controls.maxDistance = defaultDistance * 1.8;
  const offset = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(offset,
    THREE.MathUtils.clamp(defaultDistance * zoomRatio, controls.minDistance, controls.maxDistance));
  controls.update();
  controls.saveState();
  // Reset always returns to the front, not the user's pre-resize pose.
  controls.position0.copy(robot.center).addScaledVector(direction, defaultDistance);
  controls.target0.copy(robot.center);
  renderOnce();
}
function renderOnce(delta = 1 / 30, updateControls = true) {
  if (!renderer || !active()) return;
  animateRobot(robot, clock, delta, clock - waveStart, config.online, moving());
  const particles = scene.getObjectByName('atmosphere');
  if (particles) particles.rotation.y = moving() ? Math.sin(clock * 0.12) * 0.2 : 0;
  if (updateControls) controls.update();
  diagnostics.phase = diagnostics.framesRendered ? 'runtime' : 'first-frame';
  renderer.render(scene, camera);
  diagnostics.drawCalls = renderer.info.render.calls;
  if (!diagnostics.framesRendered && !diagnostics.drawCalls) {
    throw new Error('Renderer returned without scene draw calls');
  }
  diagnostics.framesRendered++;
  if (diagnostics.framesRendered === 1) {
    console.info('[AIVA3D] First scene frame rendered', {
      revision: THREE.REVISION, webgl2: diagnostics.webgl2, drawCalls: diagnostics.drawCalls,
    });
  }
  diagnostics.phase = 'runtime';
}
function tick(now) {
  frame = 0;
  if (!active() || !renderer) return;
  try {
    const step = 1000 / (config.hero ? 30 : 24);
    if (!last || now - last >= step) {
      const delta = last ? Math.min((now - last) / 1000, 0.08) : 1 / 30;
      last = now;
      if (moving()) clock += delta;
      renderOnce(delta);
    }
    if (moving() || interacting) frame = requestAnimationFrame(tick);
  } catch (error) { fail(error); }
}
function sync() {
  stop();
  clearTimeout(releaseTimer);
  if (!active()) {
    // Release offscreen contexts after a grace period, avoiding a context per
    // robot forever when scrolling through a large device list.
    if (!destroyed && !failed && renderer) releaseTimer = setTimeout(releaseGPU, 15000);
    return;
  }
  try {
    if (!renderer) initialize();
    if (failed) return;
    message();
    renderOnce();
    if (moving() || interacting) frame = requestAnimationFrame(tick);
  } catch (error) { fail(error); }
}
function wave() {
  if (!moving() || !renderer) return;
  waveStart = clock;
  sync();
}
function initialize() {
  canvasAbort = new AbortController();
  diagnostics.phase = 'webgl2-context';
  const canvas = document.createElement('canvas');
  const options = {antialias: true, alpha: true, powerPreference: 'low-power'};
  const context = canvas.getContext('webgl2', options);
  diagnostics.webgl2 = !!context;
  if (!context) throw new Error('Không tạo được WebGL2 context bên trong iframe');
  diagnostics.glVersion = context.getParameter(context.VERSION);
  diagnostics.phase = 'renderer';
  renderer = new THREE.WebGLRenderer({canvas, context, ...options});
  diagnostics.rendererInitialized = true;
  diagnostics.rendererInitializations = (diagnostics.rendererInitializations || 0) + 1;
  renderer.debug.onShaderError = () => {
    diagnostics.phase = 'shader';
    throw new Error('AIVA shader compilation failed');
  };
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Robot AIVA 3D. Kéo để xoay, cuộn để thu phóng. Phím mũi tên để xoay; + và - để zoom; R để reset; W để vẫy tay.');
  mount.prepend(renderer.domElement);
  diagnostics.phase = 'model';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  robot = createRobot(config.online, config.hero);
  scene.add(robot.root);
  controls = createControls(camera, renderer.domElement, robot.center);
  camera.position.copy(robot.center).addScaledVector(direction, defaultDistance);
  diagnostics.phase = 'environment';
  addEnvironment();
  unbindControlRender = bindControlRender(controls,
    update => renderOnce(1 / 30, update), error => fail(error), () => !interacting);
  controls.addEventListener('start', () => { interacting = true; sync(); });
  controls.addEventListener('end', () => { interacting = false; sync(); });
  listenCanvas('webglcontextlost', event => {
    event.preventDefault();
    fail(new Error('WebGL context lost'), 'context-lost');
  });
  listenCanvas('pointerdown', event => {
    if (event.isPrimary && event.button === 0) down = {x: event.clientX, y: event.clientY, at: performance.now()};
  });
  listenCanvas('pointercancel', () => { down = null; });
  listenCanvas('pointerup', event => {
    if (!down || event.button !== 0) return;
    const click = Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5 && performance.now() - down.at < 450;
    down = null;
    if (!click || !moving()) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    if (ray.intersectObject(robot.root, true).length) wave();
  });
  listenCanvas('dblclick', () => { controls.reset(); sync(); });
  listenCanvas('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'r', 'R', 'w', 'W'].includes(event.key)) return;
    event.preventDefault();
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (event.key === 'ArrowLeft') spherical.theta -= 0.15;
    if (event.key === 'ArrowRight') spherical.theta += 0.15;
    if (event.key === 'ArrowUp') spherical.phi -= 0.1;
    if (event.key === 'ArrowDown') spherical.phi += 0.1;
    if (['+', '='].includes(event.key)) spherical.radius *= 0.9;
    if (event.key === '-') spherical.radius *= 1.1;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    if (event.key.toLowerCase() === 'r') controls.reset();
    if (event.key.toLowerCase() === 'w') wave();
    controls.update(); sync();
  });
  diagnostics.phase = 'first-frame';
  resize();
  if (failed) return;
  if (savedView) {
    const distance = THREE.MathUtils.clamp(savedView.offset.length() / savedView.distance * defaultDistance,
                                         controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).addScaledVector(savedView.offset.clone().normalize(), distance);
    controls.update();
    renderOnce();
  }
  stage.classList.add('ready');
  fallback.hidden = true;
}
listen(pauseButton, 'click', () => { localPaused = !localPaused; waveStart = -Infinity; sync(); });
listen(waveButton, 'click', wave);
listen(resetButton, 'click', () => { controls?.reset(); sync(); });
listen(document, 'visibilitychange', sync);
listen(reduced, 'change', () => { waveStart = -Infinity; sync(); });
listen(window, 'pagehide', event => { if (!event.persisted) dispose(); else stop(); });
listen(window, 'pageshow', sync);
resizeObserver = new ResizeObserver(() => { try { resize(); } catch (error) { fail(error); } });
resizeObserver.observe(mount);
stopWatchingTheme = watchParentTheme(light => {
  lightTheme = light;
  document.body.classList.toggle('light', light);
  document.body.classList.toggle('dark', !light);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  diagnostics.theme = light ? 'light' : 'dark';
  if (renderer && !failed && !destroyed) {
    applySceneTheme(scene, renderer, light, config.online);
    renderOnce(1 / 30, false);
  }
});
intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, {threshold: 0.01});
intersectionObserver.observe(stage);
message();
