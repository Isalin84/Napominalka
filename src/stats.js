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
    // Неделя с понедельника: воскресенье (getDay() === 0) отстоит от него на 6 дней.
    const from = addDays(today, -((now.getDay() + 6) % 7));
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
  const targets = new Map();
  for (const exercise of Array.isArray(exercises) ? exercises : []) {
    const target = Number(exercise?.target);
    if (Number.isFinite(target) && target >= 1) targets.set(exercise.id, target);
  }
  const pairs = new Map();
  for (const { item, date } of inPeriod) {
    if (!targets.has(item.exerciseId)) continue;
    const key = `${dayKey(date)}|${item.exerciseId}`;
    const amount = Number(item.amount);
    const pair = pairs.get(key) ?? { exerciseId: item.exerciseId, total: 0 };
    pair.total += Number.isFinite(amount) ? amount : 0;
    pairs.set(key, pair);
  }
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
