import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { respawnTarget } from '../public/analysis/targetPlacement.js';

const width = 1000, height = 600;
const point = (x, y) => ({ x: x / width, y: y / height });
const landmarks = Array.from({ length: 25 }, () => point(0, 0));
landmarks[0] = point(500, 120);
landmarks[11] = point(400, 200);
landmarks[12] = point(600, 200);
landmarks[15] = point(350, 300);
landmarks[16] = point(650, 300);
landmarks[23] = point(450, 400);
landmarks[24] = point(550, 400);
// Shoulder width is 200, so with a 70px screen edge the boxes below are [xmin, xmax, ymin, ymax].
const options = { width, height, radius: 25, margin: 70, avoidHandsPx: 0 };

// Corners of the box: Math.random() = 0 gives (xmin, ymin), 0.999999 gives (xmax, ymax).
function corners(type, side, pose = landmarks) {
  const random = mock.method(Math, 'random');
  const get = (value) => { random.mock.mockImplementation(() => value); return respawnTarget(pose, { ...options, type, side }); };
  const result = [get(0), get(0.999999)];
  random.mock.restore();
  return result;
}

test('jabs span the midline to 1 shoulder past the shoulder, head level to mid-chest', () => {
  assert.deepEqual(corners('jab', 'L'), [[200, 70], [500, 300]]);
  assert.deepEqual(corners('jab', 'R'), [[500, 70], [800, 300]]);
});

test('hooks target the opposite shoulder ±0.25 shoulder width, head level to 1 shoulder down', () => {
  assert.deepEqual(corners('hook', 'L'), [[550, 70], [650, 400]]);
  assert.deepEqual(corners('hook', 'R'), [[350, 70], [450, 400]]);
});

test('uppercuts span the midline to 0.2 shoulder past the shoulder, 1.5 shoulders above to the shoulder line', () => {
  assert.deepEqual(corners('uppercut', 'L'), [[360, 70], [500, 200]]);
  assert.deepEqual(corners('uppercut', 'R'), [[500, 70], [640, 200]]);
});

test('the uppercut top sits 1.5 shoulder widths above the shoulders, ignoring the nose', () => {
  const pose = landmarks.slice();
  pose[0] = point(500, 500);    // nose far below the shoulders: must not move the box
  pose[11] = point(450, 400);   // shoulders at y=400, width 100 → top at 400 - 150 = 250
  pose[12] = point(550, 400);
  assert.deepEqual(corners('uppercut', 'L', pose), [[430, 250], [500, 400]]);
});

test('an unknown type falls back to the original torso region', () => {
  assert.deepEqual(corners('mystery', 'L'), [[200, 120], [475, 300]]);
});

test('hook spawns stay within the frame and handle a narrow shoulder width', () => {
  const narrow = landmarks.slice();
  narrow[11] = point(485, 200);
  narrow[12] = point(515, 200);
  for (const side of ['L', 'R']) {
    const [x, y] = respawnTarget(narrow, { ...options, type: 'hook', side });
    assert.ok(x >= 70 && x <= width - 70);
    assert.ok(y >= 70 && y <= height - 70);
  }
});

test('hook placement avoids hands when a suitable point is found', (t) => {
  const pose = landmarks.slice();
  pose[15] = point(550, 70);   // left hand sits on the first candidate
  const values = [0, 0, 0.999999, 0.999999];
  t.mock.method(Math, 'random', () => values.shift());
  assert.deepEqual(
    respawnTarget(pose, { ...options, type: 'hook', side: 'L', avoidHandsPx: 90 }),
    [650, 400],
  );
});
