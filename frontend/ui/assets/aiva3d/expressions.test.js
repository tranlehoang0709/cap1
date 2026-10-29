import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSIONS, createExpressionController} from './expressions.js';
import {createRobot, animateRobot} from './model.js';

test('neutral preserves original pose and rejects unknown IDs', () => {
  const controller = createExpressionController();
  assert.equal(controller.id, 'neutral');
  assert.equal(controller.select('sad'), false);
  const a = createRobot(), b = createRobot();
  animateRobot(a, 2, 1/30, Infinity, true, true);
  animateRobot(b, 2, 1/30, Infinity, true, true, controller.update(1/30, true, true));
  assert.deepEqual(a.eyes.map(e => e.scale.toArray()), b.eyes.map(e => e.scale.toArray()));
  assert.deepEqual(a.mouth.scale.toArray(), b.mouth.scale.toArray());
});

test('all presets transition smoothly, repeat without accumulation and retain blink/wave', () => {
  const controller = createExpressionController(), robot = createRobot();
  for (let repeat = 0; repeat < 4; repeat++) for (const id of Object.keys(EXPRESSIONS)) {
    controller.select(id);
    for (let frame = 0; frame < 90; frame++) {
      animateRobot(robot, 2, 1/30, 1, true, true, controller.update(1/30, true, true));
    }
    assert.equal(robot.eyes[0].scale.x, 0.125 * EXPRESSIONS[id].eyeX);
    assert.ok(robot.arms[1].shoulder.rotation.z > 2);
    animateRobot(robot, 6.73, 0.08, Infinity, true, true, controller.update(0.08, true, true));
    assert.ok(robot.eyes[0].scale.y < 0.06);
  }
});

test('pause/reduced motion applies selected static pose; offline restores neutral', () => {
  const controller = createExpressionController(), robot = createRobot();
  controller.select('sleepy');
  animateRobot(robot, 2, 1/30, 1, true, false, controller.update(1/30, false, true));
  assert.equal(robot.eyes[0].scale.y, 0.225 * EXPRESSIONS.sleepy.eyeY);
  assert.equal(robot.body.scale.y, 1);
  assert.equal(robot.arms[1].shoulder.rotation.z, robot.arms[1].basePose.shoulder.rotation.z);
  assert.deepEqual(controller.update(1/30, false, false), EXPRESSIONS.neutral);
});
