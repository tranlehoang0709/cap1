// ID dùng chung cho UI và renderer; chưa định nghĩa giao thức lệnh bên ngoài.
export const EXPRESSIONS = Object.freeze({
  neutral: Object.freeze({eyeX: 1, eyeY: 1, tilt: 0, mouthX: 1, mouthY: 1}),
  happy: Object.freeze({eyeX: 1.12, eyeY: 0.72, tilt: 0.12, mouthX: 1.18, mouthY: 1.3}),
  sleepy: Object.freeze({eyeX: 1.08, eyeY: 0.28, tilt: -0.08, mouthX: 0.8, mouthY: 0.55}),
  excited: Object.freeze({eyeX: 1.2, eyeY: 1.16, tilt: 0.06, mouthX: 1.25, mouthY: 1.42}),
});

export function createExpressionController() {
  let id = 'neutral';
  const pose = {...EXPRESSIONS.neutral};
  const keys = Object.keys(pose);
  return {
    get id() { return id; },
    select(next) {
      if (!Object.hasOwn(EXPRESSIONS, next)) return false;
      id = next;
      return true;
    },
    update(delta, moving, online) {
      const target = EXPRESSIONS[online ? id : 'neutral'];
      const blend = moving ? 1 - Math.exp(-12 * Math.max(0, delta)) : 1;
      for (const key of keys) {
        pose[key] += (target[key] - pose[key]) * blend;
        if (Math.abs(target[key] - pose[key]) < 1e-7) pose[key] = target[key];
      }
      return pose;
    },
  };
}
