const test = require('node:test');
const assert = require('node:assert/strict');
const {
  holdSeconds,
  localDayTotals,
  migrateExerciseState,
  normalizeExercises,
  validateAmount
} = require('../lib/exercises.cjs');

test('normalizes exercise configuration and drops malformed entries', () => {
  const exercises = normalizeExercises([
    { id: 'squats', name: '  Приседания  ', unit: 'reps', target: '40', perSet: '15', enabled: false },
    { id: 'squats', name: 'duplicate', target: 1, perSet: 1 },
    { id: 'bad id', name: 'Broken', target: 1, perSet: 1 }
  ]);

  assert.deepEqual(exercises, [{
    id: 'squats', name: 'Приседания', unit: 'reps', target: 40, perSet: 15, enabled: false
  }]);
});

test('migrates the legacy movement reminder without discarding default exercises', () => {
  const migrated = migrateExerciseState({
    reminders: { movement: { exercise: 'Приседания', amount: '18 раз', enabled: true } },
    history: [{ id: 'old', key: 'movement' }]
  });
  const squats = migrated.exercises.find((exercise) => exercise.id === 'squats');

  assert.equal(migrated.exercises.length, 3);
  assert.equal(squats.perSet, 18);
  assert.equal(migrated.exerciseCursor, 0);
});

test('migrates a custom Cyrillic legacy exercise to a durable ASCII identifier', () => {
  const migrated = migrateExerciseState({
    reminders: { movement: { exercise: 'Растяжка шеи', amount: '45 секунд' } }
  });
  const custom = migrated.exercises.find((exercise) => exercise.name === 'Растяжка шеи');
  const reloaded = migrateExerciseState(JSON.parse(JSON.stringify(migrated)));

  assert.match(custom.id, /^[a-z0-9_-]+$/);
  assert.equal(custom.unit, 'seconds');
  assert.equal(custom.perSet, 45);
  assert.deepEqual(reloaded.exercises.find((exercise) => exercise.id === custom.id), custom);
});

test('validates positive whole-number counts within the supported limit', () => {
  assert.equal(validateAmount('12'), 12);
  assert.equal(validateAmount(100000), 100000);
  assert.equal(validateAmount('12.5'), null);
  assert.equal(validateAmount(0), null);
  assert.equal(validateAmount(100001), null);
});

test('totals logs by the local calendar day', () => {
  const day = new Date(2026, 8, 21, 12, 0, 0);
  const totals = localDayTotals([
    { exerciseId: 'squats', amount: 10, completedAt: new Date(2026, 8, 21, 8, 0, 0).toISOString() },
    { exerciseId: 'squats', amount: 5, completedAt: new Date(2026, 8, 20, 23, 59, 59).toISOString() },
    { exerciseId: 'pushups', amount: 7, completedAt: new Date(2026, 8, 21, 9, 0, 0).toISOString() }
  ], day);

  assert.deepEqual(totals, { squats: 10, pushups: 7 });
});

test('holdSeconds takes the set size for timed exercises', () => {
  assert.equal(holdSeconds({ unit: 'seconds', perSet: 45 }), 45);
});

test('holdSeconds gives three seconds per repetition', () => {
  assert.equal(holdSeconds({ unit: 'reps', perSet: 12 }), 36);
});

test('holdSeconds clamps short sets to the lower bound', () => {
  assert.equal(holdSeconds({ unit: 'reps', perSet: 5 }), 20);
  assert.equal(holdSeconds({ unit: 'seconds', perSet: 10 }), 20);
});

test('holdSeconds clamps long sets to the upper bound', () => {
  assert.equal(holdSeconds({ unit: 'reps', perSet: 100000 }), 300);
  assert.equal(holdSeconds({ unit: 'seconds', perSet: 4000 }), 300);
});

test('holdSeconds falls back to the lower bound on unusable input', () => {
  assert.equal(holdSeconds(null), 20);
  assert.equal(holdSeconds({}), 20);
  assert.equal(holdSeconds({ unit: 'reps', perSet: 'много' }), 20);
  assert.equal(holdSeconds({ unit: 'reps', perSet: -4 }), 20);
  assert.equal(holdSeconds({ unit: 'reps', perSet: 0 }), 20);
});
