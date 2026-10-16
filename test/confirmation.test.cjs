const test = require('node:test');
const assert = require('node:assert/strict');
const { gateFor, isSatisfied } = require('../lib/confirmation.cjs');

const hardState = { hardMode: { enabled: true, confirmBy: 'timer' } };
const movement = { type: 'movement', exerciseId: 'squats', holdSeconds: 36 };

test('gateFor returns no gate when hard mode is off', () => {
  assert.deepEqual(gateFor(movement, { hardMode: { enabled: false } }), { kind: 'none' });
  assert.deepEqual(gateFor(movement, {}), { kind: 'none' });
});

test('gateFor returns no gate for anything but movement', () => {
  assert.deepEqual(gateFor({ type: 'water' }, hardState), { kind: 'none' });
  assert.deepEqual(gateFor({ type: 'custom', title: 'Проветрить' }, hardState), { kind: 'none' });
});

test('gateFor returns no gate for movement without an exercise', () => {
  assert.deepEqual(gateFor({ type: 'movement', holdSeconds: 36 }, hardState), { kind: 'none' });
});

test('gateFor returns a timer gate for movement in hard mode', () => {
  assert.deepEqual(gateFor(movement, hardState), { kind: 'timer', seconds: 36 });
});

test('gateFor treats an unknown confirmBy as a timer', () => {
  const state = { hardMode: { enabled: true, confirmBy: 'pulse' } };
  assert.deepEqual(gateFor(movement, state), { kind: 'timer', seconds: 36 });
});

test('gateFor returns no gate when holdSeconds is unusable', () => {
  assert.deepEqual(gateFor({ type: 'movement', exerciseId: 'squats' }, hardState), { kind: 'none' });
  assert.deepEqual(gateFor({ ...movement, holdSeconds: 0 }, hardState), { kind: 'none' });
  assert.deepEqual(gateFor({ ...movement, holdSeconds: NaN }, hardState), { kind: 'none' });
});

test('isSatisfied is true when there is no gate', () => {
  assert.equal(isSatisfied({ kind: 'none' }, { elapsedMs: 0 }), true);
});

test('isSatisfied is false before the time is up', () => {
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, { elapsedMs: 30000 }), false);
});

test('isSatisfied allows a second of slack between clocks', () => {
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, { elapsedMs: 35200 }), true);
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, { elapsedMs: 34800 }), false);
});

test('isSatisfied is true once the time is up', () => {
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, { elapsedMs: 40000 }), true);
});

test('isSatisfied opens the gate on unusable elapsed time', () => {
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, { elapsedMs: NaN }), true);
  assert.equal(isSatisfied({ kind: 'timer', seconds: 36 }, {}), true);
});
