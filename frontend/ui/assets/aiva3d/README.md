# AIVA Three.js component

The existing `ui.motion.render_robot_scene(*, hero=False, online=True)` entry
point remains a compatibility re-export. Its implementation now lives in
`thanh_phan/robot/khung_hien_thi.py` and embeds a self-contained document with
`st.iframe`. `thanh_phan/robot/tai_lieu_3d.py` reads this unchanged asset folder
through `nen_tang.duong_dan.ASSETS_DIR`, independent of the working directory;
`ui/aiva3d.py` remains a compatibility re-export. See
[the structure guide](../../../HUONG_DAN_CAU_TRUC.md).

The IIFE bundle includes Three.js 0.180.0, OrbitControls, RoundedBoxGeometry and
RoomEnvironment. It is loaded inline in iframe `srcdoc`, without CDN, network
requests, module imports, a static server or additional Python dependencies.
Only trusted local assets and boolean scene configuration are embedded. No
user messages, keys or account details are passed to JavaScript.

## Files

- `model.js`: geometry, materials, blink/idle/wave animation and disposal.
- `controls.js`: shared OrbitControls configuration.
- `scene.js`: renderer, lighting, camera sizing, events and lifecycle.
- `template.html`, `style.css`: isolated iframe UI and original SVG fallback.
- `diagnostics.js`: iframe bootstrap and classified errors, loaded before bundle.
- `robot.bundle.js`: prebuilt runtime asset; distribute this with the app.
- `package.json`, `package-lock.json`: pinned build dependencies.
- `THREE-LICENSE.txt`: Three.js MIT license.
- `model.test.js`, `controls.test.js`, `fallback.test.js`: CPU-based Node tests.

Node/npm are needed only to rebuild or run JavaScript tests. The Streamlit app
does not require `node_modules` or Node at runtime.

## Build

From this directory:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run build
npm.cmd test
node --check robot.bundle.js
```

esbuild 0.25.10 is a build-only dependency. Its platform binary is installed as
an optional npm package; this workflow does not execute npm lifecycle scripts.

## States and performance

- Existing `online`, `appearance` and `aiva_pause_robot` are passed through.
- The scene observes the parent document's root `color-scheme`, which the existing
  Streamlit `appearance` state controls. Dark retains navy/cyan. Light uses a soft
  white/light-blue background, pale floor, blue particles and dark controls/text.
  Lighting intensity/exposure adjusts for the white robot; its materials and cyan
  eyes/core are unchanged. `theme.js` updates existing objects in place.
- Theme alone does not change iframe srcdoc, so Streamlit does not navigate the
  iframe to new HTML or reset the camera. Parent stylesheet mutations synchronize
  the scene without a separate toggle, polling loop or renderer reconstruction.
- Offline scenes dim their eyes/core and render on demand. Paused and
  reduced-motion scenes do not continuously render, but camera controls work.
- Local pause is per iframe. It cannot override the Streamlit global pause or
  the OS reduced-motion preference.
- No listening/thinking/speaking states are inferred from an open chat session.
- Renderer creation is deferred until the scene is visible. Frame rates are
  capped at 24 fps for cards and 30 fps for the login hero. DPR caps are 1.25/1.75.
- Hidden/offscreen scenes stop their RAF loop. After 15 seconds they release
  geometry, materials, environment maps, shadows, listeners and WebGL context.
  Returning to view recreates the scene and restores its camera offset/zoom.
- Page unload disconnects observers, aborts listeners and releases GPU resources.
- Camera distance uses a sphere containing antenna, feet, idle offsets and
  raised arms, accounting for both horizontal and vertical field of view.
  Zoom-in is intentionally conservative to keep the whole robot inside the card.
- WebGL2 is required by this Three.js version. Failed renderer creation, shader
  compilation or context loss switches to the original SVG in
  `thanh_phan/robot/du_phong.py` (re-exported by `ui/robot.py`) with
  a classified fallback notice. JavaScript/renderer errors are reported with
  their original message, not as unavailable WebGL.

## Verification

Automated checks passed on 2026-10-13:

- Seven Node tests: real geometry/proportions, animation poses, camera containment
  over full rotations and five canvas sizes, disposal, actual OrbitControls
  pointer/wheel/reset events in a simulated DOM, raycasting and shipped-bundle
  fallback when canvas context creation fails.
- `checks/robot3d.py`: 16 configuration combinations and actual Streamlit iframe
  output for login, pause, dashboard, three device states and both themes.
- Existing `checks/smoke.py`, `checks/reference.py` and `checks/tables.py`.
- Python compilation, JavaScript syntax and `git diff --check`.

These are CPU/Streamlit tests. They do not prove GPU shader output, lighting,
visual fidelity, native browser gestures, mobile touch behavior, actual FPS or
browser context reclamation. Browser inventory was empty in this session.

## Integration fix and browser diagnostics

The initial render could recurse: `OrbitControls.change` invoked `renderOnce`,
which called `controls.update()` before OrbitControls committed its last pose.
This was reproduced with the installed Three.js as `RangeError: Maximum call
stack size exceeded` (2,031 recursive calls). The change listener now renders
without calling update again; a regression test checks the actual control.

Runtime is an inline, prebundled IIFE. There is no import map, runtime ES-module
resolution or external script URL; JS MIME types/static paths do not participate.
The renderer now requests `webgl2` on its actual canvas inside the iframe, then
passes that same canvas/context to Three.js. Diagnostics track bundle execution,
context, renderer, model/environment/shader errors and the first scene draw calls.

Fifteen Node tests and the Streamlit integration checks pass after the runtime,
arm-pose and theme fixes.
Successful real WebGL rendering is still UNVERIFIED without browser evidence.

At localhost:8501, press Ctrl+F5. Open F12 > Console and select the robot iframe
execution context (`about:srcdoc`). Inspect:

```javascript
window.__AIVA3D__
```

Successful initialization should show `bundleLoaded: true`, `threeRevision:
"180"`, `webgl2: true`, `rendererInitialized: true`, `framesRendered > 0`,
`drawCalls > 0`, and `lastError: null`. The console prints `[AIVA3D] First scene
frame rendered` after a completed render with draw calls. Confirm the robot is
visibly 3D and rotation, wheel zoom and waving work as well.

If fallback persists, copy the full `[AIVA3D]` error and its stack or run:

```javascript
JSON.stringify(window.__AIVA3D__, null, 2)
```

The Network panel should not show requests for Three.js or robot assets: they
are included in the iframe HTML. Streamlit's own requests are expected.

To verify theme synchronization, rotate/zoom the robot and switch Dark > Light >
Dark with the existing application toggle. In the robot iframe Console inspect
`window.__AIVA3D__.theme` and `window.__AIVA3D__.rendererInitializations`. Theme
should follow the toggle while the initialization count and camera angle remain
unchanged. Do this while the viewer stays visible; the intentional 15-second
offscreen context release can increment the count independently of theme.
Automated tests check theme colors, restoration, stable scene/camera objects,
parent CSS observation and identical login/dashboard iframe HTML across theme
reruns. Actual browser appearance and GPU lifecycle remain unverified here.

## Local visual check

```powershell
cd E:\captone\frontend
.\.venv\Scripts\python.exe -m streamlit run app.py
```

Visit http://localhost:8501 and hard-refresh if an old page is open.

1. At login, check the 350px robot, its silhouette and uninterrupted antenna/feet.
2. Drag left/right through a full revolution, scroll both ways, double-click to
   reset, and click on the robot or use `Vẫy tay`.
3. Observe idle floating, breathing, smile/LED motion and a blink after several
   seconds. Use `Dừng` and the existing Streamlit pause toggle.
4. Sign in with `user@example.test` / `Demo123!`. Inspect the Dashboard 200px
   card and `Thiết bị của tôi`, including the dim, stationary offline robot.
5. Switch light/dark mode and narrow the browser. Try keyboard arrows, +/- zoom,
   R reset and W wave when the canvas has focus.
6. Hide the tab or scroll scenes out of view for 15 seconds, then return. Check
   reinitialization and inspect browser console for WebGL errors.
7. To test fallback, temporarily disable browser graphics acceleration if your
   browser then disables WebGL, restart it and confirm the SVG fallback notice.
   Re-enable acceleration afterward. Browser-specific GPU behavior varies.

The original SVG and all existing app forms, navigation, authorization and
session-local business operations remain intact.
