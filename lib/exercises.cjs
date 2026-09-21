const MAX_AMOUNT = 100000;

const DEFAULT_EXERCISES = Object.freeze([
  Object.freeze({ id: 'squats', name: 'Приседания', unit: 'reps', target: 30, perSet: 12, enabled: true }),
  Object.freeze({ id: 'pushups', name: 'Отжимания', unit: 'reps', target: 20, perSet: 10, enabled: true }),
  Object.freeze({ id: 'pullups', name: 'Подтягивания', unit: 'reps', target: 10, perSet: 5, enabled: true })
]);

function cloneDefaults() {
  return DEFAULT_EXERCISES.map((exercise) => ({ ...exercise }));
}

function text(value, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeName(value) {
  return text(value).toLocaleLowerCase('ru-RU');
}

function validId(value) {
  const id = text(value, 100);
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function validateAmount(value, max = MAX_AMOUNT) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const amount = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isSafeInteger(amount) && amount > 0 && amount <= max ? amount : null;
}

function parseLegacyAmount(value) {
  if (typeof value === 'number') return validateAmount(value);
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+/);
  return match ? validateAmount(match[0]) : null;
}

function legacyUnit(value) {
  return typeof value === 'string' && /сек|second|sec/i.test(value) ? 'seconds' : 'reps';
}

function defaultFor(id) {
  return DEFAULT_EXERCISES.find((exercise) => exercise.id === id);
}

function normalizeExercises(rawExercises, useDefaultsWhenMissing = true) {
  if (!Array.isArray(rawExercises)) return useDefaultsWhenMissing ? cloneDefaults() : [];

  const usedIds = new Set();
  return rawExercises.reduce((result, raw, index) => {
    if (!raw || typeof raw !== 'object') return result;
    const id = validId(raw.id);
    const name = text(raw.name);
    if (!id || !name || usedIds.has(id)) return result;

    const fallback = defaultFor(id);
    const unit = raw.unit === 'seconds' ? 'seconds' : raw.unit === 'reps' ? 'reps' : (fallback?.unit || 'reps');
    const perSet = validateAmount(raw.perSet) || fallback?.perSet || 10;
    // `dailyGoal` was used by an unreleased prototype; accept it once while
    // keeping the public persisted field named `target`.
    const target = validateAmount(raw.target) || validateAmount(raw.dailyGoal) || fallback?.target || perSet;
    usedIds.add(id);
    result.push({
      id,
      name,
      unit,
      target,
      perSet,
      enabled: raw.enabled !== false
    });
    return result;
  }, []);
}

function normalizeExerciseLog(rawLog, exercises = []) {
  if (!Array.isArray(rawLog)) return [];
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const usedIds = new Set();
  return rawLog.reduce((result, raw) => {
    if (!raw || typeof raw !== 'object') return result;
    const id = validId(raw.id);
    const exerciseId = validId(raw.exerciseId);
    const exercise = byId.get(exerciseId);
    const amount = validateAmount(raw.amount);
    const completedAt = new Date(raw.completedAt);
    if (!id || !exerciseId || !amount || Number.isNaN(completedAt.getTime()) || usedIds.has(id)) return result;
    usedIds.add(id);
    result.push({
      id,
      exerciseId,
      name: text(raw.name) || exercise?.name || 'Упражнение',
      unit: raw.unit === 'seconds' ? 'seconds' : raw.unit === 'reps' ? 'reps' : (exercise?.unit || 'reps'),
      amount,
      completedAt: completedAt.toISOString()
    });
    return result;
  }, []);
}

function idFromName(name, usedIds) {
  const transliteration = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h',
    ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };
  const base = [...normalizeName(name)]
    .map((character) => transliteration[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'exercise';
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function migrateExerciseState(saved = {}) {
  const hasExercises = Array.isArray(saved.exercises);
  const exercises = normalizeExercises(saved.exercises, !hasExercises);
  const legacyMovement = saved?.reminders?.movement;
  let selectedIndex = Number.isSafeInteger(saved.exerciseCursor) && saved.exerciseCursor >= 0
    ? saved.exerciseCursor
    : 0;

  // Older versions stored one movement name and amount on the reminder itself.
  // Apply it only while creating the new exercise model, so later renderer saves
  // cannot overwrite a user's deliberate exercise configuration.
  if (!hasExercises && legacyMovement && typeof legacyMovement === 'object') {
    const name = text(legacyMovement.exercise);
    const amount = parseLegacyAmount(legacyMovement.amount);
    if (name) {
      let index = exercises.findIndex((exercise) => normalizeName(exercise.name) === normalizeName(name));
      if (index === -1) {
        const usedIds = new Set(exercises.map((exercise) => exercise.id));
        exercises.push({
          id: idFromName(name, usedIds),
          name,
          unit: legacyUnit(legacyMovement.amount),
          target: amount || 10,
          perSet: amount || 10,
          enabled: legacyMovement.enabled !== false
        });
        index = exercises.length - 1;
      } else if (amount) {
        exercises[index].perSet = amount;
      }
      selectedIndex = index;
    }
  }

  return {
    exercises,
    exerciseLog: normalizeExerciseLog(saved.exerciseLog, exercises),
    exerciseCursor: exercises.length ? selectedIndex % exercises.length : 0
  };
}

function activeExercises(exercises) {
  return Array.isArray(exercises) ? exercises.filter((exercise) => exercise?.enabled) : [];
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDayTotals(exerciseLog, date = new Date()) {
  const day = localDayKey(date);
  return (Array.isArray(exerciseLog) ? exerciseLog : []).reduce((totals, item) => {
    if (localDayKey(item?.completedAt) !== day) return totals;
    const amount = validateAmount(item.amount);
    if (amount && item.exerciseId) totals[item.exerciseId] = (totals[item.exerciseId] || 0) + amount;
    return totals;
  }, {});
}

module.exports = {
  DEFAULT_EXERCISES,
  MAX_AMOUNT,
  activeExercises,
  localDayKey,
  localDayTotals,
  migrateExerciseState,
  normalizeExerciseLog,
  normalizeExercises,
  validateAmount
};
