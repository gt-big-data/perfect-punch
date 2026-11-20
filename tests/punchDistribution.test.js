import test from 'node:test';
import assert from 'node:assert/strict';
import {
  punchTotals, baseWeights, PunchPicker, DEFAULT_WEIGHTS, MIN_WEIGHT, PUNCH_TYPES,
} from '../public/analysis/punchDistribution.js';

const attempt = (type, hit) => ({ predicted_punch: type, hit_target: hit });
const session = (...attempts) => ({ punch_attempts: attempts });
const near = (actual, expected) => {
  for (const t of PUNCH_TYPES) assert.ok(Math.abs(actual[t] - expected[t]) < 1e-9, `${t}: ${actual[t]} vs ${expected[t]}`);
};
const sum = (w) => PUNCH_TYPES.reduce((n, t) => n + w[t], 0);

test('totals count punches thrown and hit per type across sessions', () => {
  const totals = punchTotals([
    session(attempt('jab', true), attempt('jab', false), attempt('hook', true)),
    session(attempt('Jab', true), attempt('uppercut', false), attempt('mystery', true)),
  ]);
  assert.deepEqual(totals, {
    jab: { thrown: 3, correct: 2 }, hook: { thrown: 1, correct: 1 }, uppercut: { thrown: 1, correct: 0 },
  });
});

test('totals use only the 10 most recent sessions that have attempts', () => {
  const sessions = [{ summary: {} }];                                   // no attempt list: skipped
  for (let i = 0; i < 10; i++) sessions.push(session(attempt('jab', true)));
  sessions.push(session(attempt('hook', false)));                        // 11th session with attempts: dropped
  const totals = punchTotals(sessions);
  assert.deepEqual(totals.jab, { thrown: 10, correct: 10 });
  assert.deepEqual(totals.hook, { thrown: 0, correct: 0 });
});

test('no history, or a failed fetch, falls back to the default split', () => {
  assert.deepEqual(baseWeights(punchTotals([])), DEFAULT_WEIGHTS);
  assert.deepEqual(baseWeights(punchTotals(null)), DEFAULT_WEIGHTS);
});

test('weights follow smoothed miss rates, so bigger samples count more', () => {
  // Miss rates: jab (6+1)/(10+2) = 7/12, hook (2+1)/(10+2) = 3/12, uppercut (4+1)/(10+2) = 5/12.
  const w = baseWeights({ jab: { thrown: 10, correct: 4 }, hook: { thrown: 10, correct: 8 }, uppercut: { thrown: 10, correct: 6 } });
  near(w, { jab: 7 / 15, hook: 3 / 15, uppercut: 5 / 15 });
});

test('a type with no misses keeps at least the minimum weight', () => {
  const w = baseWeights({ jab: { thrown: 40, correct: 40 }, hook: { thrown: 10, correct: 0 }, uppercut: { thrown: 10, correct: 0 } });
  assert.ok(Math.abs(w.jab - MIN_WEIGHT) < 1e-9);
  assert.ok(Math.abs(w.hook - w.uppercut) < 1e-9);
  assert.ok(Math.abs(sum(w) - 1) < 1e-9);
});

test('a repeated type loses 10% of its weight, shared in proportion among the others', () => {
  const picker = new PunchPicker({ jab: 0.5, hook: 0.3, uppercut: 0.2 });
  assert.equal(picker.next(() => 0), 'jab');
  near(picker.weights, { jab: 0.5, hook: 0.3, uppercut: 0.2 });          // first pick: no change
  assert.equal(picker.next(() => 0), 'jab');
  near(picker.weights, { jab: 0.45, hook: 0.33, uppercut: 0.22 });       // 0.05 split 3:2
  assert.equal(picker.next(() => 0), 'jab');
  near(picker.weights, { jab: 0.405, hook: 0.357, uppercut: 0.238 });
  assert.ok(Math.abs(sum(picker.weights) - 1) < 1e-9);
});

test('breaking the streak resets to the base distribution', () => {
  const base = { jab: 0.5, hook: 0.3, uppercut: 0.2 };
  const picker = new PunchPicker(base);
  picker.next(() => 0);
  picker.next(() => 0);
  assert.equal(picker.next(() => 0.99), 'uppercut');
  near(picker.weights, base);
});
