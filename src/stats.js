// Арифметика периодов статистики. Только даты: ни DOM, ни Electron сюда не лезут.

// Дальше этого числа суток точки по дням сливаются в кашу, и шаг становится недельным.
export const GRAIN_WEEK_THRESHOLD_DAYS = 70;

// Намеренный дубль localDayKey из lib/exercises.cjs: главный процесс на
// CommonJS, рендерер на ES-модулях, общего синхронного импорта между ними нет.
export function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
// Сдвиг через календарь, а не через миллисекунды: в сутки перевода часов не 24 часа.
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
// Неделя с понедельника: воскресенье (getDay() === 0) отстоит от него на 6 дней.
const mondayOf = (date) => addDays(startOfDay(date), -((date.getDay() + 6) % 7));

// Считаем по UTC-компонентам, чтобы переход на летнее время не давал дробных суток.
function daysBetween(from, to) {
  const utc = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc(to) - utc(from)) / 86400000);
}

function earliestEntry(log) {
  let earliest = null;
  for (const item of Array.isArray(log) ? log : []) {
    const date = new Date(item?.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
}

// Предыдущий период обрезается по длине прожитой части текущего: в среду
// прошлую неделю сравниваем с её средой, а не целиком, иначе цифры нечестны.
function clippedPrevious(previousFrom, previousLastDay, livedDays) {
  const clipped = endOfDay(addDays(previousFrom, livedDays - 1));
  return { from: previousFrom, to: clipped > previousLastDay ? previousLastDay : clipped };
}

export function periodRange(period, now, log = []) {
  const today = startOfDay(now);
  const to = endOfDay(now);

  if (period === 'day') {
    // То же правило обрезки, только внутри суток: вчера до этого же часа и минуты.
    const yesterday = addDays(today, -1);
    const sameMoment = new Date(
      yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()
    );
    return { from: today, to, grain: 'hour', previous: { from: yesterday, to: sameMoment } };
  }

  if (period === 'week') {
    const from = mondayOf(now);
    const previousFrom = addDays(from, -7);
    return {
      from,
      to,
      grain: 'day',
      previous: clippedPrevious(previousFrom, endOfDay(addDays(previousFrom, 6)), daysBetween(from, today) + 1)
    };
  }

  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // Нулевое число месяца — последний день предыдущего: так 31 марта не уезжает за 28 февраля.
    const previousLastDay = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
    return {
      from,
      to,
      grain: 'day',
      previous: clippedPrevious(previousFrom, previousLastDay, now.getDate())
    };
  }

  // Сюда же попадает неизвестный период: «всё время» — самый безобидный ответ,
  // экран покажет лишнее, но не соврёт и не упадёт.
  const earliest = earliestEntry(log);
  const first = earliest ? startOfDay(earliest) : today;
  // Запись из будущего (сбитые часы) не должна переворачивать диапазон.
  const from = first > today ? today : first;
  const spanDays = daysBetween(from, today) + 1;
  return {
    from,
    to,
    grain: spanDays > GRAIN_WEEK_THRESHOLD_DAYS ? 'week' : 'day',
    previous: null
  };
}

// Записи с непригодной датой молча пропускаются, как и в earliestEntry: один
// битый completedAt не должен ронять весь экран.
function entriesBetween(log, from, to) {
  const result = [];
  for (const item of Array.isArray(log) ? log : []) {
    const date = new Date(item?.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (date >= from && date <= to) result.push({ item, date });
  }
  return result;
}

// Серия считается от now, а не от границ периода: она не принадлежит периоду.
export function streakDays(log, now) {
  const days = new Set();
  for (const item of Array.isArray(log) ? log : []) {
    const key = dayKey(item?.completedAt);
    if (key) days.add(key);
  }
  let cursor = startOfDay(now);
  // Пока сегодня ничего не записано, серия не оборвана: у человека есть время до полуночи.
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// Нечисловое количество считается нулём: один битый amount не должен делать
// из суммы NaN.
function amountOf(item) {
  const amount = Number(item?.amount);
  return Number.isFinite(amount) ? amount : 0;
}

// Цели берутся только из списка упражнений, не из записей лога. Упражнение без
// цели от единицы сюда не попадает.
function goalTargets(exercises) {
  const targets = new Map();
  for (const exercise of Array.isArray(exercises) ? exercises : []) {
    const target = Number(exercise?.target);
    if (Number.isFinite(target) && target >= 1) targets.set(exercise.id, target);
  }
  return targets;
}

// Суммы по парам «день и упражнение» для упражнений, которые знает `known`
// (всё, у чего есть .has). Общий проход для долей целей в summarize и для
// goalDays/activeDays в byExercise: считать их по-разному нельзя.
function dayExercisePairs(entries, known) {
  const pairs = new Map();
  for (const { item, date } of entries) {
    if (!known.has(item.exerciseId)) continue;
    const key = `${dayKey(date)}|${item.exerciseId}`;
    const pair = pairs.get(key) ?? { exerciseId: item.exerciseId, total: 0 };
    pair.total += amountOf(item);
    pairs.set(key, pair);
  }
  return pairs;
}

export function summarize(log, exercises, range, now) {
  const inPeriod = entriesBetween(log, range.from, range.to);

  // range.to у periodRange — конец сегодняшних суток, так что будущие дни сюда
  // не попадают: в среду неделя — это 3 дня, а не 7.
  const totalDays = daysBetween(range.from, startOfDay(range.to)) + 1;

  const activeDays = new Set(inPeriod.map(({ date }) => dayKey(date))).size;

  // Знаменатель доли целей — пары «день и упражнение», по которым в этот день
  // была хотя бы одна запись, а не все теоретически возможные: иначе цифра
  // наказывает за дни, когда упражнение и не планировалось. Упражнение без
  // цели от единицы в дробь не идёт вовсе, это же закрывает деление на ноль.
  const targets = goalTargets(exercises);
  const pairs = dayExercisePairs(inPeriod, targets);
  let goalsHit = 0;
  for (const { exerciseId, total } of pairs.values()) {
    if (total >= targets.get(exerciseId)) goalsHit += 1;
  }

  const deltaSets = range.previous
    ? inPeriod.length - entriesBetween(log, range.previous.from, range.previous.to).length
    : null;

  return {
    sets: inPeriod.length,
    activeDays,
    totalDays,
    streak: streakDays(log, now),
    goalsHit,
    goalsPossible: pairs.size,
    deltaSets
  };
}

const pad2 = (value) => String(value).padStart(2, '0');

// Ось бакетов строится заранее и целиком: пустой шаг обязан остаться на оси,
// иначе пропуск не будет виден провалом. Ключ шага считает keyOf для записи.
function bucketAxis(range) {
  if (range.grain === 'hour') {
    const steps = Array.from({ length: 24 }, (_, hour) => ({ key: hour, label: String(hour) }));
    return { steps, keyOf: (date) => date.getHours() };
  }
  const steps = [];
  if (range.grain === 'week') {
    // Недельный шаг подписан понедельником: по нему видно, какую неделю он держит.
    for (let monday = mondayOf(range.from); monday <= range.to; monday = addDays(monday, 7)) {
      steps.push({ key: dayKey(monday), label: `${pad2(monday.getDate())}.${pad2(monday.getMonth() + 1)}` });
    }
    return { steps, keyOf: (date) => dayKey(mondayOf(date)) };
  }
  for (let day = startOfDay(range.from); day <= range.to; day = addDays(day, 1)) {
    steps.push({ key: dayKey(day), label: String(day.getDate()) });
  }
  return { steps, keyOf: (date) => dayKey(date) };
}

export function bucketSets(log, range) {
  const { steps, keyOf } = bucketAxis(range);
  const counts = new Map(steps.map((step) => [step.key, 0]));
  for (const { date } of entriesBetween(log, range.from, range.to)) {
    const key = keyOf(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return steps.map((step) => ({ ...step, sets: counts.get(step.key) }));
}

export function byExercise(log, exercises, range) {
  const list = Array.isArray(exercises) ? exercises : [];
  const { steps, keyOf } = bucketAxis(range);
  const indexByKey = new Map(steps.map((step, index) => [step.key, index]));
  const known = new Set(list.map((exercise) => exercise?.id));
  // Пустая плитка нужна дважды: под первую запись упражнения и под упражнение
  // без записей вовсе. Это функция, а не значение: spark у каждой плитки свой.
  const emptyStat = () => ({ total: 0, sets: 0, spark: steps.map(() => 0) });

  // Один проход по логу на оба периода. Предыдущий кончается раньше начала
  // текущего (иногда с зазором из-за обрезки), поэтому запись в зазоре не
  // принадлежит ни тому ни другому. Записи упражнений, которых нет в списке,
  // считаются здесь же вхолостую: плитка строится по списку, и они не видны.
  const wide = entriesBetween(log, range.previous?.from ?? range.from, range.to);
  const current = [];
  const previousTotals = new Map();
  for (const record of wide) {
    if (record.date >= range.from) {
      current.push(record);
    } else if (range.previous && record.date <= range.previous.to) {
      const id = record.item.exerciseId;
      previousTotals.set(id, (previousTotals.get(id) ?? 0) + amountOf(record.item));
    }
  }

  const stats = new Map();
  for (const { item, date } of current) {
    const stat = stats.get(item.exerciseId) ?? emptyStat();
    const amount = amountOf(item);
    stat.total += amount;
    stat.sets += 1;
    stat.spark[indexByKey.get(keyOf(date))] += amount;
    stats.set(item.exerciseId, stat);
  }

  const targets = goalTargets(list);
  const goalDays = new Map();
  const activeDays = new Map();
  for (const { exerciseId, total } of dayExercisePairs(current, known).values()) {
    activeDays.set(exerciseId, (activeDays.get(exerciseId) ?? 0) + 1);
    if (targets.has(exerciseId) && total >= targets.get(exerciseId)) {
      goalDays.set(exerciseId, (goalDays.get(exerciseId) ?? 0) + 1);
    }
  }

  // Имя, единица и цель — из списка упражнений: в записи лежит имя на момент
  // записи, после переименования одно упражнение раздвоилось бы на две плитки.
  // Выключенное упражнение остаётся, пока у него есть записи за период.
  // Цель уходит уже нормализованной, через тот же goalTargets, по которому
  // считается goalDays: вид не должен решать заново, что считается целью.
  return list
    .filter((exercise) => exercise?.enabled || stats.has(exercise?.id))
    .map((exercise) => {
      const stat = stats.get(exercise.id) ?? emptyStat();
      const before = previousTotals.get(exercise.id) ?? 0;
      return {
        id: exercise.id,
        name: exercise.name,
        unit: exercise.unit,
        target: targets.get(exercise.id) ?? null,
        total: stat.total,
        sets: stat.sets,
        spark: stat.spark,
        deltaPercent: before > 0 ? Math.round(((stat.total - before) / before) * 100) : null,
        goalDays: goalDays.get(exercise.id) ?? 0,
        activeDays: activeDays.get(exercise.id) ?? 0
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function calendarWeeks(log, now, weeks = 5) {
  const today = startOfDay(now);
  const first = addDays(mondayOf(now), -(weeks - 1) * 7);
  const counts = new Map();
  for (const item of Array.isArray(log) ? log : []) {
    const key = dayKey(item?.completedAt);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = addDays(first, week * 7 + weekday);
      const key = dayKey(day);
      return { key, sets: counts.get(key) ?? 0, inFuture: day > today };
    })
  );
}
