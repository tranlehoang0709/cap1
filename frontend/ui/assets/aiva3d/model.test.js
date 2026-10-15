import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRobot, animateRobot, fitDistance, disposeScene} from './model.js';

test('AIVA uses real geometry with the original head/body proportions', () => {
  const robot = createRobot();
  let meshes = 0;
  robot.root.traverse(item => { if (item.isMesh) {
    meshes++;
    assert.ok(item.geometry.isBufferGeometry);
    assert.ok(item.geometry.attributes.position.count > 0);
    assert.equal(item.material.map, null);
  }});
  assert.ok(meshes >= 25);
  assert.equal(robot.eyes.length, 2);
  assert.equal(robot.arms.length, 2);
  assert.ok(robot.head.children[0].geometry.parameters.width > robot.body.children[0].geometry.parameters.width);
  assert.equal(robot.mouth.geometry.type, 'TubeGeometry');
});

test('idle, blink and wave differ from the neutral/offline pose and finish smoothly', () => {
  const robot = createRobot();
  animateRobot(robot, 2, 1 / 24, -1, true, true);
  assert.notEqual(robot.root.position.y, 0);
  assert.notEqual(robot.body.scale.y, 1);
  animateRobot(robot, 6.73, 0.08, 1, true, true);
  assert.ok(robot.eyes[0].scale.y < 0.06);
  assert.ok(robot.arms[1].shoulder.rotation.z > 2);
  animateRobot(robot, 7.5, 0.08, 2.49, true, true);
  assert.ok(robot.arms[1].shoulder.rotation.z < 0.25);
  animateRobot(robot, 8, 0.08, 3, true, true);
  assert.equal(robot.arms[1].shoulder.rotation.z, 0.13);
  animateRobot(robot, 2, 0.08, 1, false, false);
  assert.equal(robot.root.position.y, 0);
  assert.equal(robot.body.scale.y, 1);
  assert.equal(robot.cyan.emissiveIntensity, 0.08);
  assert.equal(robot.arms[1].shoulder.rotation.z, 0.13);
});

test('full model fits the closest zoom across 360-degree views, widths and wave poses', () => {
  const robot = createRobot();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  // Canvas sizes include the toolbar/footer reservation at both iframe heights.
  for (const [width, height] of [[160,144], [300,144], [500,294], [280,294], [900,294]]) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const distance = fitDistance(robot.radius, camera.aspect, camera.fov) / 1.06;
    for (const waveTime of [Infinity, -1, 0.2, 0.7, 1.3, 2.2, 3]) {
      animateRobot(robot, 2.2, 1 / 24, waveTime, true, true);
      robot.root.updateMatrixWorld(true);
      for (const phi of [Math.PI * 0.28, Math.PI / 2, Math.PI * 0.66]) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
          camera.position.copy(robot.center).add(new THREE.Vector3().setFromSphericalCoords(distance, phi, angle));
          camera.lookAt(robot.center);
          camera.updateMatrixWorld(true);
          robot.root.traverse(item => {
            if (!item.isMesh) return;
            const positions = item.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              const vertex = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(item.matrixWorld);
              assert.ok(vertex.distanceTo(robot.center) <= robot.radius, 'animated model exceeds camera-fit sphere');
              vertex.project(camera);
              assert.ok(Math.abs(vertex.x) < 1 && Math.abs(vertex.y) < 1, 'model clipped by camera');
            }
          });
        }
      }
    }
  }
});

test('geometry and shared materials are disposed once each', () => {
  const robot = createRobot();
  const scene = new THREE.Scene();
  scene.add(robot.root);
  const resources = new Set();
  robot.root.traverse(item => { if (item.isMesh) { resources.add(item.geometry); resources.add(item.material); } });
  const counts = new Map();
  resources.forEach(resource => resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1)));
  disposeScene(scene);
  assert.equal(counts.size, resources.size);
  counts.forEach(count => assert.equal(count, 1));
});

test('both arms keep finite, symmetric base poses before the first click and throughout idle', () => {
  const robot = createRobot();
  for (const time of [0, 1.2, 5, 30]) {
    animateRobot(robot, time, 1 / 30, Infinity, true, true);
    robot.root.updateMatrixWorld(true);
    for (const arm of robot.arms) {
      for (const joint of [arm.shoulder, arm.elbow]) {
        assert.ok(joint.visible);
        assert.ok(joint.matrixWorld.elements.every(Number.isFinite));
      }
      assert.deepEqual(arm.shoulder.rotation.toArray(), arm.basePose.shoulder.rotation.toArray());
      assert.deepEqual(arm.elbow.rotation.toArray(), arm.basePose.elbow.rotation.toArray());
    }
    const [left, right] = robot.arms;
    assert.equal(left.shoulder.position.x, -right.shoulder.position.x);
    assert.equal(left.shoulder.position.y, right.shoulder.position.y);
    assert.equal(left.shoulder.position.z, right.shoulder.position.z);
    assert.equal(left.shoulder.rotation.z, -right.shoulder.rotation.z);
  }
});

test('wave returns exactly to base pose, including after repeated clicks and invalid times', () => {
  const robot = createRobot();
  for (let click = 0; click < 20; click++) {
    animateRobot(robot, 3, 1 / 30, 1.1, true, true);
    const firstPose = robot.arms[1].shoulder.quaternion.clone();
    animateRobot(robot, 3, 1 / 30, 1.1, true, true);
    assert.ok(firstPose.equals(robot.arms[1].shoulder.quaternion));
    for (const waveTime of [0, 2.5, 3, Infinity, -Infinity, NaN]) {
      animateRobot(robot, 4, 1 / 30, waveTime, true, true);
      for (const arm of robot.arms) {
        for (const key of ['shoulder', 'elbow']) {
          assert.deepEqual(arm[key].position.toArray(), arm.basePose[key].position.toArray());
          assert.deepEqual(arm[key].rotation.toArray(), arm.basePose[key].rotation.toArray());
          assert.deepEqual(arm[key].scale.toArray(), arm.basePose[key].scale.toArray());
        }
      }
    }
  }
});

test('both forearms are in frame and unobstructed from the default front camera', () => {
  const robot = createRobot();
  const camera = new THREE.PerspectiveCamera(34, 300 / 144, 0.1, 100);
  const direction = new THREE.Vector3(0.12, 0.025, 1).normalize();
  camera.position.copy(robot.center).addScaledVector(direction, fitDistance(robot.radius, camera.aspect, camera.fov));
  camera.lookAt(robot.center);
  camera.updateMatrixWorld(true);
  for (const [waveTime, moving] of [[Infinity,true], [0,true], [0.6,true], [1.2,true],
                                    [2.2,true], [2.5,true], [3,true], [Infinity,false], [1.2,false]]) {
    animateRobot(robot, 2, 1 / 30, waveTime, true, moving);
    robot.root.updateMatrixWorld(true);
    for (const arm of robot.arms) {
      const world = arm.elbow.localToWorld(new THREE.Vector3(0, -0.21, 0));
      const projected = world.clone().project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
      const [hit] = ray.intersectObject(robot.root, true);
      assert.ok(hit, 'arm must be raycast-visible');
      let object = hit.object;
      while (object && object !== arm.shoulder) object = object.parent;
      assert.equal(object, arm.shoulder, 'head/torso must not obscure the forearm');
    }
  }
});

test('pause/reduced-motion and offline transitions restore both arms to finite base transforms', () => {
  const robot = createRobot();
  for (const online of [true, false]) {
    animateRobot(robot, 2, 1 / 30, 1.2, true, true);
    animateRobot(robot, 2, 1 / 30, Infinity, online, false);
    robot.root.updateMatrixWorld(true);
    for (const arm of robot.arms) {
      for (const key of ['shoulder', 'elbow']) {
        assert.deepEqual(arm[key].rotation.toArray(), arm.basePose[key].rotation.toArray());
        assert.ok(arm[key].matrixWorld.elements.every(Number.isFinite));
        assert.ok(arm[key].visible);
      }
    }
  }
});
