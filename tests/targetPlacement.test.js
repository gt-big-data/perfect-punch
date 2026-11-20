import test from 'node:test';
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
const options = { width, height, radius: 25, margin: 70, avoidHandsPx: 0 };

test('hooks spawn near the head and body center on the called hand side', (t) => {
  const random = t.mock.method(Math, 'random');
  for (const [side, minX, maxX] of [['L', 400, 475], ['R', 525, 600]]) {
    for (const [value, expected] of [[0, [minX, 120]], [0.999999, [maxX, 200]]]) {
      random.mock.mockImplementation(() => value);
      assert.deepEqual(respawnTarget(landmarks, { ...options, type: 'hook', side }), expected);
    }
  }
});

test('jabs retain the original wider torso region', (t) => {
  const random = t.mock.method(Math, 'random');
  for (const [value, expected] of [[0, [200, 120]], [0.999999, [475, 300]]]) {
    random.mock.mockImplementation(() => value);
    assert.deepEqual(respawnTarget(landmarks, { ...options, type: 'jab', side: 'L' }), expected);
  }
});

test('uppercuts spawn higher while retaining the original horizontal range', (t) => {
  const random = t.mock.method(Math, 'random');
  for (const [side, minX, maxX] of [['L', 200, 475], ['R', 525, 800]]) {
    for (const [value, expected] of [[0, [minX, 120]], [0.999999, [maxX, 250]]]) {
      random.mock.mockImplementation(() => value);
      assert.deepEqual(respawnTarget(landmarks, { ...options, type: 'uppercut', side }), expected);
    }
  }
});

test('an inverted torso does not move uppercuts lower than before', (t) => {
  const pose = landmarks.slice();
  pose[23] = point(450, 100);
  pose[24] = point(550, 100);
  t.mock.method(Math, 'random', () => 0.999999);
  assert.deepEqual(respawnTarget(pose, { ...options, type: 'uppercut', side: 'L' }), [475, 150]);
});

test('hook spawns stay within the frame and handle a narrow shoulder width', () => {
  const narrow = landmarks.slice();
  narrow[11] = point(485, 200);
  narrow[12] = point(515, 200);
  for (const side of ['L', 'R']) {
    const [x, y] = respawnTarget(narrow, { ...options, type: 'hook', side });
    assert.ok(x >= 70 && x <= width - 70);
    assert.ok(y >= 120 && y <= 200);
  }
});

test('hook placement avoids hands when a suitable point is found', (t) => {
  const pose = landmarks.slice();
  pose[15] = point(400, 120);
  const values = [0, 0, 0.999999, 0.999999];
  t.mock.method(Math, 'random', () => values.shift());
  assert.deepEqual(
    respawnTarget(pose, { ...options, type: 'hook', side: 'L', avoidHandsPx: 100 }),
    [475, 200],
  );
});
