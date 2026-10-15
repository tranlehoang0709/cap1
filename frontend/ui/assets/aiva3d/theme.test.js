import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {applySceneTheme, watchParentTheme} from './theme.js';

test('dark-light-dark recolors the same scene and renderer, preserving objects and camera', () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3), new THREE.MeshStandardMaterial());
  floor.name = 'holo-floor'; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1), new THREE.MeshBasicMaterial());
  ring.name = 'holo-ring'; scene.add(ring);
  const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  particles.name = 'atmosphere'; scene.add(particles);
  for (const name of ['hemisphere', 'key', 'rim', 'fill']) {
    const light = new THREE.DirectionalLight(); light.name = `theme-${name}`; scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 2, 8); camera.rotation.set(0.1, 0.3, 0);
  scene.add(camera);
  const renderer = {toneMappingExposure: 1.05};
  const ids = scene.children.map(item => item.uuid);
  const cameraPose = [...camera.position.toArray(), ...camera.quaternion.toArray()];
  applySceneTheme(scene, renderer, false, true);
  const dark = [floor.material.color.getHex(), ring.material.color.getHex(),
    particles.material.color.getHex(), particles.material.opacity, renderer.toneMappingExposure];
  applySceneTheme(scene, renderer, true, true);
  assert.equal(floor.material.color.getHex(), 0xdce8f5);
  assert.equal(particles.material.opacity, 0.58);
  assert.equal(renderer.toneMappingExposure, 0.95);
  applySceneTheme(scene, renderer, false, true);
  assert.deepEqual([floor.material.color.getHex(), ring.material.color.getHex(),
    particles.material.color.getHex(), particles.material.opacity, renderer.toneMappingExposure], dark);
  assert.deepEqual(scene.children.map(item => item.uuid), ids);
  assert.deepEqual([...camera.position.toArray(), ...camera.quaternion.toArray()], cameraPose);
  applySceneTheme(scene, renderer, true, false);
  assert.equal(particles.material.opacity, 0.16);
});

test('parent CSS observation synchronizes theme, ignores unrelated mutations and disconnects', () => {
  let scheme = 'dark', notify, disconnected = false;
  const root = {nodeName: 'HTML'}, queue = [], themes = [];
  const parent = {document: {documentElement: root}, getComputedStyle: () => ({colorScheme: scheme})};
  const host = {parent, queueMicrotask: callback => queue.push(callback),
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe(target) { assert.equal(target, root); }
      disconnect() { disconnected = true; }
    }};
  const stop = watchParentTheme(light => themes.push(light), host);
  assert.deepEqual(themes, [false]);
  notify([{type: 'attributes', target: {nodeName: 'BUTTON'}}]);
  assert.equal(queue.length, 0);
  scheme = 'light';
  notify([{type: 'childList', target: {nodeName: 'HEAD'}, addedNodes: [{nodeName: 'STYLE'}], removedNodes: []}]);
  queue.shift()();
  assert.deepEqual(themes, [false, true]);
  scheme = 'dark';
  notify([{type: 'characterData', target: {nodeName: '#text', parentNode: {nodeName: 'STYLE'}}}]);
  queue.shift()();
  assert.deepEqual(themes, [false, true, false]);
  stop();
  assert.ok(disconnected);
});
