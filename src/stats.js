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
