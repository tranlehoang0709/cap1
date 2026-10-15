import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createControls, bindControlRender} from './controls.js';
import {createRobot} from './model.js';

test('actual OrbitControls handles pointer rotation, bounded wheel zoom and reset', () => {
  const canvas = new EventTarget(), document = new EventTarget();
  Object.assign(canvas, {style: {}, clientWidth: 300, clientHeight: 144,
    getRootNode: () => document, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 300, height: 144})});
  const camera = new THREE.PerspectiveCamera(34, 300 / 144, 0.1, 100);
  camera.position.set(0, 2, 8);
  const controls = createControls(camera, canvas, new THREE.Vector3(0, 2, 0));
  controls.minDistance = 6;
  controls.maxDistance = 12;
  controls.update();
  controls.saveState();
  const original = camera.position.clone();
  function dispatch(type, values) {
    const event = new Event(type, {cancelable: true});
    Object.assign(event, {pointerId: 1, pointerType: 'mouse', button: 0,
      clientX: 100, clientY: 70, pageX: 100, pageY: 70, ctrlKey: false,
      metaKey: false, shiftKey: false, deltaMode: 0}, values);
    canvas.dispatchEvent(event);
  }
  dispatch('pointerdown');
  dispatch('pointermove', {clientX: 160, pageX: 160});
  dispatch('pointerup', {clientX: 160, pageX: 160});
  assert.ok(camera.position.distanceTo(original) > 1);
  assert.equal(controls.minAzimuthAngle, -Infinity);
  assert.equal(controls.maxAzimuthAngle, Infinity);
  for (let i = 0; i < 100; i++) dispatch('wheel', {deltaY: -100});
  assert.ok(Math.abs(controls.getDistance() - 6) < 1e-6);
  for (let i = 0; i < 100; i++) dispatch('wheel', {deltaY: 100});
  assert.ok(Math.abs(controls.getDistance() - 12) < 1e-6);
  controls.reset();
  assert.ok(camera.position.distanceTo(original) < 1e-6);
  controls.dispose();
});

test('real raycasting hits the robot at the center and misses the empty corner', () => {
  const robot = createRobot();
  robot.root.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(34, 2, 0.1, 100);
  camera.position.set(0, 2.05, 9);
  camera.lookAt(robot.center);
  camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  assert.ok(ray.intersectObject(robot.root, true).length);
  ray.setFromCamera(new THREE.Vector2(0.95, 0.95), camera);
  assert.equal(ray.intersectObject(robot.root, true).length, 0);
});

test('initial camera-fit change cannot recursively call controls.update()', () => {
  const canvas = new EventTarget(), document = new EventTarget();
  Object.assign(canvas, {style: {}, clientWidth: 300, clientHeight: 144, getRootNode: () => document});
  const camera = new THREE.PerspectiveCamera(34, 2, 0.1, 100);
  const controls = createControls(camera, canvas, new THREE.Vector3(0, 2.05, 0));
  let renders = 0;
  const errors = [];
  const unbind = bindControlRender(controls, update => {
    renders++;
    if (update) controls.update();
  }, error => errors.push(error));
  camera.position.set(1, 2.05, 10);
  controls.update();
  assert.equal(renders, 1);
  assert.deepEqual(errors, []);
  unbind();
  controls.dispose();
});
