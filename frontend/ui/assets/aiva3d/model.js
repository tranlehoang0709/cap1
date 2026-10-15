import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function capturePose(group) {
  return {position: group.position.clone(), rotation: group.rotation.clone(), scale: group.scale.clone()};
}

function restorePose(group, pose) {
  group.position.copy(pose.position);
  group.rotation.copy(pose.rotation);
  group.scale.copy(pose.scale);
}

function logArmPose(robot, phase) {
  // Browser diagnostics only, once per phase transition, never every frame.
  if (typeof window === 'undefined' || robot.armDebugPhase === phase) return;
  robot.root.updateMatrixWorld(true);
  const poses = robot.arms.map(arm => ({
    side: arm.side,
    localPosition: arm.shoulder.position.toArray(),
    localRotation: arm.shoulder.rotation.toArray(),
    worldPosition: arm.shoulder.getWorldPosition(new THREE.Vector3()).toArray(),
    worldRotation: new THREE.Euler().setFromQuaternion(arm.shoulder.getWorldQuaternion(new THREE.Quaternion())).toArray(),
    elbowWorldPosition: arm.elbow.getWorldPosition(new THREE.Vector3()).toArray(),
    elbowRotation: arm.elbow.rotation.toArray(),
    visible: robot.root.visible && arm.shoulder.visible && arm.elbow.visible,
    finiteWorldMatrix: arm.shoulder.matrixWorld.elements.every(Number.isFinite) &&
                       arm.elbow.matrixWorld.elements.every(Number.isFinite),
  }));
  console.debug('[AIVA3D] Arm poses', phase, poses);
  robot.armDebugPhase = phase;
}

// Geometry follows robot.py: head 88x69, body 69x55, small feet and cyan face.
export function createRobot(online = true, hero = false) {
  const root = new THREE.Group();
  root.name = 'AIVA';
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xe8eff8, metalness: 0.32, roughness: 0.28,
    clearcoat: 0.7, clearcoatRoughness: 0.2,
  });
  const silver = new THREE.MeshStandardMaterial({color: 0x8ca2bd, metalness: 0.65, roughness: 0.35});
  const screen = new THREE.MeshPhysicalMaterial({
    color: 0x040c18, roughness: 0.14, metalness: 0.25, clearcoat: 1,
  });
  const cyan = new THREE.MeshStandardMaterial({
    color: online ? 0x48ddff : 0x25475c,
    emissive: 0x19caff, emissiveIntensity: online ? 1.7 : 0.08,
    roughness: 0.25, metalness: 0.15,
  });
  const segments = hero ? 4 : 3;
  function mesh(geometry, material, parent, x, y, z) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(parent, w, h, d, radius, material, x, y, z) {
    return mesh(new RoundedBoxGeometry(w, h, d, segments, radius), material, parent, x, y, z);
  }
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  box(body, 1.72, 1.36, 0.98, 0.43, shell, 0, 1.52, 0);
  mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.16, 24), silver, body, 0, 2.16, 0);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 2.88;
  root.add(head);
  box(head, 2.2, 1.73, 1.16, 0.43, shell, 0, 0, 0);
  box(head, 1.74, 1.19, 0.44, 0.21, silver, 0, -0.01, 0.53);
  box(head, 1.66, 1.11, 0.43, 0.20, screen, 0, -0.01, 0.57);
  const eyes = [-0.36, 0.36].map(x => {
    const eye = mesh(new THREE.SphereGeometry(1, 20, 12), cyan, head, x, 0.10, 0.798);
    eye.scale.set(0.125, 0.225, 0.046);
    eye.name = 'eye';
    return eye;
  });
  const smile = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.19, 0, 0), new THREE.Vector3(0, -0.17, 0),
    new THREE.Vector3(0.19, 0, 0),
  );
  const mouth = mesh(new THREE.TubeGeometry(smile, 20, 0.024, 8, false), cyan, head, 0, -0.29, 0.806);
  mouth.name = 'smile';
  mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.26, 12), silver, head, 0, 0.99, 0);
  mesh(new THREE.SphereGeometry(0.104, 20, 12), cyan, head, 0, 1.16, 0);
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.13, 20), silver, head, side * 1.12, 0, 0);
    ear.rotation.z = Math.PI / 2;
  }
  mesh(new THREE.TorusGeometry(0.2, 0.055, 10, 28), silver, body, 0, 1.56, 0.505);
  const chest = mesh(new THREE.SphereGeometry(0.145, 20, 12), cyan, body, 0, 1.56, 0.54);
  chest.scale.z = 0.27;
  box(body, 0.53, 0.035, 0.028, 0.012, silver, 0, 1.02, 0.44);

  const arms = [-1, 1].map(side => {
    const shoulder = new THREE.Group();
    shoulder.name = side === 1 ? 'wave-arm' : 'left-arm';
    shoulder.position.set(side * 1.02, 1.95, 0);
    shoulder.rotation.z = side * 0.13;
    root.add(shoulder);
    mesh(new THREE.SphereGeometry(0.18, 16, 12), silver, shoulder, 0, 0, 0);
    mesh(new THREE.CapsuleGeometry(0.18, 0.29, 4, 12), shell, shoulder, 0, -0.29, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.56;
    shoulder.add(elbow);
    mesh(new THREE.SphereGeometry(0.13, 12, 8), silver, elbow, 0, 0, 0);
    mesh(new THREE.CapsuleGeometry(0.17, 0.15, 4, 12), shell, elbow, 0, -0.21, 0);
    return {shoulder, elbow, side,
      basePose: {shoulder: capturePose(shoulder), elbow: capturePose(elbow)}};
  });
  for (const side of [-1, 1]) {
    mesh(new THREE.CapsuleGeometry(0.23, 0.4, 4, 16), shell, root, side * 0.46, 0.58, 0);
    box(root, 0.59, 0.25, 0.72, 0.12, silver, side * 0.46, 0.19, 0.13);
  }
  // Bounding sphere includes idle displacement, head tilt and fully raised hand.
  const robot = {root, head, body, eyes, mouth, arms, cyan, center: new THREE.Vector3(0, 2.05, 0), radius: 2.25};
  logArmPose(robot, 'initialized');
  return robot;
}

export function fitDistance(radius, aspect, fovDegrees) {
  const vertical = THREE.MathUtils.degToRad(fovDegrees / 2);
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.1));
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.06;
}

export function animateRobot(robot, time, delta, waveTime, online, moving) {
  const {root, head, body, eyes, mouth, arms, cyan} = robot;
  const idle = moving && online;
  root.position.y = idle ? Math.sin(time * 1.5) * 0.065 : 0;
  body.scale.y = idle ? 1 + Math.sin(time * 2.1) * 0.012 : 1;
  head.rotation.set(idle ? Math.sin(time * 0.9) * 0.025 : 0,
                    idle ? Math.sin(time * 0.65) * 0.05 : 0, 0);
  // Two short closures per 6.7 seconds, never driven by a fake AI state.
  const cycle = time % 6.7;
  const blink = idle && (cycle < 0.14 || (cycle > 0.3 && cycle < 0.41));
  const eyeTarget = blink ? 0.025 : 0.225;
  for (const eye of eyes) eye.scale.y = THREE.MathUtils.damp(eye.scale.y, eyeTarget, 45, delta);
  mouth.scale.y = idle ? 1 + Math.sin(time * 1.5) * 0.065 : 1;
  cyan.emissiveIntensity = online ? (idle ? 1.55 + Math.sin(time * 2.2) * 0.22 : 1.55) : 0.08;
  for (const arm of arms) {
    restorePose(arm.shoulder, arm.basePose.shoulder);
    restorePose(arm.elbow, arm.basePose.elbow);
  }
  // Before the first click, clock - (-Infinity) is Infinity. Even 0 * sin(Infinity)
  // produces NaN, invalidating the arm's world matrix and making it disappear.
  const waving = Number.isFinite(waveTime) && waveTime >= 0 && waveTime <= 2.5 && online && moving;
  if (waving) {
    const ramp = Math.min(waveTime / 0.35, (2.5 - waveTime) / 0.4, 1);
    const blend = THREE.MathUtils.smoothstep(ramp, 0, 1);
    const arm = arms[1];
    arm.shoulder.rotation.z += blend * (2.35 + Math.sin(waveTime * 11) * 0.2);
    arm.elbow.rotation.z += blend * (0.35 + Math.sin(waveTime * 11 + 0.5) * 0.25);
  }
  logArmPose(robot, !online ? 'offline' : !moving ? 'paused/reduced-motion' :
    waving && waveTime > 0 && waveTime < 2.5 ? 'waving' : 'idle');
}

export function disposeScene(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(item => {
    if (item.shadow) item.shadow.dispose();
    if (item.geometry) geometries.add(item.geometry);
    for (const material of (Array.isArray(item.material) ? item.material : [item.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}
