import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, periodRange, streakDays, summarize, bucketSets, byExercise, calendarWeeks, GRAIN_WEEK_THRESHOLD_DAYS
} from '../src/stats.js';

const AT = (iso) => new Date(iso);
const entry = (iso) => ({ id: iso, exerciseId: 'squats', amount: 10, unit: 'reps', completedAt: iso });
const ex = (id, target) => ({ id, name: id, unit: 'reps', target, perSet: 10, enabled: true });
const rec = (exerciseId, iso, amount) => ({ id: `${exerciseId}-${iso}`, exerciseId, name: exerciseId, unit: 'reps', amount, completedAt: iso });

test('dayKey отдаёт локальную дату', () => {
  assert.equal(dayKey('2026-10-16T05:50:07.522Z'), dayKey(new Date('2026-10-16T05:50:07.522Z')));
  assert.match(dayKey('2026-10-16T12:00:00'), /^\d{4}-\d{2}-\d{2}$/);
});

test('dayKey отдаёт null на мусоре', () => {
  assert.equal(dayKey('позавчера'), null);
  assert.equal(dayKey(undefined), null);
  assert.equal(dayKey(''), null);
});

test('день — одни сутки, шаг часовой', () => {
  const r = periodRange('day', AT('2026-10-16T14:00:00'));
  assert.equal(r.grain, 'hour');
  assert.equal(dayKey(r.from), '2026-10-16');
  assert.equal(dayKey(r.to), '2026-10-16');
});

test('вчера обрезается по времени суток, а не берётся целиком', () => {
  // Правило обрезки предыдущего периода действует и внутри суток: в девять
  // утра один сегодняшний подход нельзя сравнивать со всеми вчерашними.
  const r = periodRange('day', AT('2026-10-16T09:30:00'));
  assert.equal(dayKey(r.previous.from), '2026-10-15');
  assert.equal(r.previous.from.getHours(), 0);
  assert.equal(dayKey(r.previous.to), '2026-10-15');
  assert.equal(r.previous.to.getHours(), 9);
  assert.equal(r.previous.to.getMinutes(), 30);
});

test('неделя начинается с понедельника', () => {
  // 16 октября 2026 — пятница
  const r = periodRange('week', AT('2026-10-16T14:00:00'));
  assert.equal(dayKey(r.from), '2026-10-12');
  assert.equal(dayKey(r.to), '2026-10-16');
  assert.equal(r.grain, 'day');
});

test('воскресенье относится к уходящей неделе, а не к следующей', () => {
  const r = periodRange('week', AT('2026-10-18T10:00:00'));
  assert.equal(dayKey(r.from), '2026-10-12');
});

test('предыдущая неделя обрезана по длине прожитой части текущей', () => {
  // пятница: прожито 5 дней, значит и в прошлой неделе берём 5
  const r = periodRange('week', AT('2026-10-16T14:00:00'));
  assert.equal(dayKey(r.previous.from), '2026-10-05');
  assert.equal(dayKey(r.previous.to), '2026-10-09');
});

test('месяц идёт с первого числа, предыдущий обрезан так же', () => {
  const r = periodRange('month', AT('2026-10-16T14:00:00'));
  assert.equal(dayKey(r.from), '2026-10-01');
  assert.equal(dayKey(r.to), '2026-10-16');
  assert.equal(dayKey(r.previous.from), '2026-09-01');
  assert.equal(dayKey(r.previous.to), '2026-09-16');
});

test('короткий прошлый месяц не выходит за свой последний день', () => {
  const r = periodRange('month', AT('2026-03-31T14:00:00'));
  assert.equal(dayKey(r.previous.to), '2026-02-28');
});

test('всё время начинается с самой ранней записи, предыдущего нет', () => {
  const log = [entry('2026-09-21T13:14:16'), entry('2026-10-16T05:50:07.522Z')];
  const r = periodRange('all', AT('2026-10-16T14:00:00'), log);
  assert.equal(dayKey(r.from), '2026-09-21');
  assert.equal(r.previous, null);
  assert.equal(r.grain, 'day');
});

test('всё время при пустом логе — один сегодняшний день', () => {
  const r = periodRange('all', AT('2026-10-16T14:00:00'), []);
  assert.equal(dayKey(r.from), '2026-10-16');
  assert.equal(dayKey(r.to), '2026-10-16');
});

test('шаг становится недельным за порогом в 70 дней', () => {
  assert.equal(GRAIN_WEEK_THRESHOLD_DAYS, 70);
  const near = periodRange('all', AT('2026-10-16T14:00:00'), [entry('2026-08-15T10:00:00')]);
  assert.equal(near.grain, 'day');
  const far = periodRange('all', AT('2026-10-16T14:00:00'), [entry('2026-01-01T10:00:00')]);
  assert.equal(far.grain, 'week');
});

test('записи с непригодной датой не двигают начало всего времени', () => {
  const log = [{ id: 'x', exerciseId: 'squats', amount: 10, completedAt: 'вчера' }, entry('2026-10-10T10:00:00')];
  const r = periodRange('all', AT('2026-10-16T14:00:00'), log);
  assert.equal(dayKey(r.from), '2026-10-10');
});

test('запись из будущего не переворачивает диапазон всего времени', () => {
  // Сбитые часы или правка файла руками: from позже to сломал бы всё, что считается ниже.
  const r = periodRange('all', AT('2026-10-16T14:00:00'), [entry('2026-10-20T10:00:00')]);
  assert.ok(r.from <= r.to);
  assert.equal(dayKey(r.from), '2026-10-16');
  assert.equal(dayKey(r.to), '2026-10-16');
});

test('серия считает непрерывный хвост до сегодня', () => {
  const log = ['2026-10-14', '2026-10-15', '2026-10-16'].map((d) => rec('squats', `${d}T10:00:00`, 10));
  assert.equal(streakDays(log, AT('2026-10-16T20:00:00')), 3);
});

test('серия не обнуляется до полуночи, если сегодня ещё пусто', () => {
  const log = ['2026-10-14', '2026-10-15'].map((d) => rec('squats', `${d}T10:00:00`, 10));
  assert.equal(streakDays(log, AT('2026-10-16T09:00:00')), 2);
});

test('серия обрывается на пропуске', () => {
  const log = ['2026-10-10', '2026-10-15', '2026-10-16'].map((d) => rec('squats', `${d}T10:00:00`, 10));
  assert.equal(streakDays(log, AT('2026-10-16T20:00:00')), 2);
});

test('серия равна нулю, если нет ни сегодня, ни вчера', () => {
  assert.equal(streakDays([rec('squats', '2026-10-01T10:00:00', 10)], AT('2026-10-16T20:00:00')), 0);
  assert.equal(streakDays([], AT('2026-10-16T20:00:00')), 0);
});

test('totalDays не считает будущие дни недели', () => {
  const now = AT('2026-10-14T12:00:00'); // среда
  const s = summarize([], [], periodRange('week', now), now);
  assert.equal(s.totalDays, 3);
});

test('сводка считает подходы и дни', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-14T10:00:00', 20),
    rec('squats', '2026-10-14T18:00:00', 20),
    rec('squats', '2026-10-16T10:00:00', 20)
  ];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.sets, 3);
  assert.equal(s.activeDays, 2);
});

test('знаменатель целей — только пары день и упражнение с записями', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-14T10:00:00', 30),   // цель 30 взята
    rec('squats', '2026-10-15T10:00:00', 12),   // не взята
    rec('pushups', '2026-10-15T10:00:00', 25)   // цель 20 взята
  ];
  const s = summarize(log, [ex('squats', 30), ex('pushups', 20)], periodRange('week', now), now);
  assert.equal(s.goalsPossible, 3);
  assert.equal(s.goalsHit, 2);
});

test('упражнение без пригодной цели выпадает из дроби', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('plank', '2026-10-14T10:00:00', 60), rec('squats', '2026-10-14T10:00:00', 30)];
  const s = summarize(log, [{ ...ex('plank', 0) }, ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.goalsPossible, 1);
  assert.equal(s.goalsHit, 1);
});

test('пустой период не даёт NaN', () => {
  const now = AT('2026-10-16T20:00:00');
  const s = summarize([], [ex('squats', 30)], periodRange('week', now), now);
  assert.deepEqual(
    { sets: s.sets, activeDays: s.activeDays, goalsHit: s.goalsHit, goalsPossible: s.goalsPossible },
    { sets: 0, activeDays: 0, goalsHit: 0, goalsPossible: 0 }
  );
  assert.equal(Number.isFinite(s.deltaSets), true);
});

test('deltaSets равен null, когда предыдущего периода нет', () => {
  const now = AT('2026-10-16T20:00:00');
  const s = summarize([], [], periodRange('all', now, []), now);
  assert.equal(s.deltaSets, null);
});

test('deltaSets сравнивает с обрезанным предыдущим периодом', () => {
  const now = AT('2026-10-16T20:00:00'); // пятница, прожито 5 дней
  const log = [
    rec('squats', '2026-10-12T10:00:00', 10),
    rec('squats', '2026-10-13T10:00:00', 10),
    rec('squats', '2026-10-05T10:00:00', 10),
    rec('squats', '2026-10-11T10:00:00', 10)  // воскресенье прошлой недели, в обрезку не входит
  ];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.deltaSets, 1);
});

test('границы периода проверяются по часам: полночь входит, секунда до неё нет', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-11T23:59:59', 10),  // последняя секунда воскресенья, вне недели
    rec('squats', '2026-10-12T00:00:00', 10),  // первая секунда понедельника
    rec('squats', '2026-10-16T23:59:59', 10),  // позже now, но в тех же сутках
    rec('squats', '2026-10-17T00:00:00', 10)   // уже завтра
  ];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.sets, 2);
});

test('подходы за несколько записей одного дня складываются в одну пару', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-14T10:00:00', 20), rec('squats', '2026-10-14T18:00:00', 10)];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.goalsPossible, 1);
  assert.equal(s.goalsHit, 1);
});

test('упражнение, которого уже нет в списке, в дробь целей не входит', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('lunges', '2026-10-14T10:00:00', 50), rec('squats', '2026-10-14T10:00:00', 5)];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.goalsPossible, 1);
  assert.equal(s.goalsHit, 0);
  assert.equal(s.sets, 2);
});

test('серия считается от now, а не от границ выбранного периода', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
    .map((d) => rec('squats', `${d}T10:00:00`, 10));
  const s = summarize(log, [ex('squats', 30)], periodRange('day', now), now);
  assert.equal(s.sets, 1);
  assert.equal(s.streak, 5);
});

test('запись, сделанная в последнюю секунду вчерашнего дня, держит серию', () => {
  const log = [rec('squats', '2026-10-15T23:59:59', 10)];
  assert.equal(streakDays(log, AT('2026-10-16T00:00:01')), 1);
});

test('запись из будущего не удлиняет серию', () => {
  const log = [rec('squats', '2026-10-17T10:00:00', 10), rec('squats', '2026-10-18T10:00:00', 10)];
  assert.equal(streakDays(log, AT('2026-10-16T20:00:00')), 0);
});

test('запись с непригодной датой не попадает ни в подходы, ни в серию', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', 'вчера', 10), rec('squats', '2026-10-16T10:00:00', 10)];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.sets, 1);
  assert.equal(s.streak, 1);
});

test('deltaSets отрицателен, когда предыдущий период был активнее', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-05T10:00:00', 10),
    rec('squats', '2026-10-06T10:00:00', 10),
    rec('squats', '2026-10-12T10:00:00', 10)
  ];
  const s = summarize(log, [ex('squats', 30)], periodRange('week', now), now);
  assert.equal(s.deltaSets, -1);
});

test('totalDays для всего времени идёт от первой записи до сегодня включительно', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-10T10:00:00', 10)];
  const s = summarize(log, [ex('squats', 30)], periodRange('all', now, log), now);
  assert.equal(s.totalDays, 7);
});

test('deltaSets за день сравнивает с вчерашним днём до того же часа', () => {
  const now = AT('2026-10-16T09:30:00');
  const log = [
    rec('squats', '2026-10-16T08:00:00', 10),  // сегодня
    rec('squats', '2026-10-15T09:00:00', 10),  // вчера до 09:30, входит
    rec('squats', '2026-10-15T09:31:00', 10),  // вчера после 09:30, не входит
    rec('squats', '2026-10-15T18:00:00', 10)   // вчера вечером, не входит
  ];
  const s = summarize(log, [ex('squats', 30)], periodRange('day', now), now);
  assert.equal(s.sets, 1);
  assert.equal(s.deltaSets, 0);
});

test('дневные бакеты включают пустые дни', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-12T10:00:00', 10), rec('squats', '2026-10-16T10:00:00', 10)];
  const buckets = bucketSets(log, periodRange('week', now));
  assert.equal(buckets.length, 5);
  assert.deepEqual(buckets.map((b) => b.sets), [1, 0, 0, 0, 1]);
  assert.equal(buckets[0].key, '2026-10-12');
  assert.equal(buckets[0].label, '12');
});

test('часовые бакеты — ровно сутки', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-16T09:30:00', 10), rec('squats', '2026-10-16T09:45:00', 10)];
  const buckets = bucketSets(log, periodRange('day', now));
  assert.equal(buckets.length, 24);
  assert.equal(buckets[9].sets, 2);
  assert.equal(buckets[10].sets, 0);
});

test('недельные бакеты подписаны датой понедельника', () => {
  const now = AT('2026-10-16T20:00:00');
  const range = periodRange('all', now, [rec('squats', '2026-01-01T10:00:00', 10)]);
  const buckets = bucketSets([rec('squats', '2026-10-14T10:00:00', 10)], range);
  assert.equal(range.grain, 'week');
  assert.equal(buckets.at(-1).label, '12.10');
  assert.equal(buckets.at(-1).sets, 1);
});

test('запись с непригодной датой не попадает ни в один бакет', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [{ id: 'x', exerciseId: 'squats', amount: 10, completedAt: 'вчера' }];
  const buckets = bucketSets(log, periodRange('week', now));
  assert.equal(buckets.reduce((sum, b) => sum + b.sets, 0), 0);
});

test('имя плитки берётся из списка упражнений, а не из записи', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    { id: 'a', exerciseId: 'squats', name: 'Старое имя', unit: 'reps', amount: 20, completedAt: '2026-10-14T10:00:00' },
    { id: 'b', exerciseId: 'squats', name: 'Приседания', unit: 'reps', amount: 20, completedAt: '2026-10-15T10:00:00' }
  ];
  const tiles = byExercise(log, [{ ...ex('squats', 30), name: 'Приседания' }], periodRange('week', now));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Приседания');
  assert.equal(tiles[0].total, 40);
});

test('нечисловое количество считается нулём и не ломает сумму', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    { id: 'a', exerciseId: 'squats', amount: 'много', completedAt: '2026-10-14T10:00:00' },
    rec('squats', '2026-10-15T10:00:00', 20)
  ];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].total, 20);
});

test('выключенное упражнение остаётся, если есть записи за период', () => {
  const now = AT('2026-10-16T20:00:00');
  const exercises = [{ ...ex('squats', 30), enabled: false }, ex('pushups', 20)];
  const tiles = byExercise([rec('squats', '2026-10-14T10:00:00', 20)], exercises, periodRange('week', now));
  assert.deepEqual(tiles.map((t) => t.id).sort(), ['pushups', 'squats']);
});

test('выключенное упражнение без записей за период не показывается', () => {
  const now = AT('2026-10-16T20:00:00');
  const exercises = [{ ...ex('squats', 30), enabled: false }, ex('pushups', 20)];
  const tiles = byExercise([], exercises, periodRange('week', now));
  assert.deepEqual(tiles.map((t) => t.id), ['pushups']);
});

test('плитки отсортированы по итогу по убыванию', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-14T10:00:00', 20), rec('pushups', '2026-10-14T10:00:00', 50)];
  const tiles = byExercise(log, [ex('squats', 30), ex('pushups', 20)], periodRange('week', now));
  assert.deepEqual(tiles.map((t) => t.id), ['pushups', 'squats']);
});

test('spark выровнен по бакетам', () => {
  const now = AT('2026-10-16T20:00:00');
  const range = periodRange('week', now);
  const log = [rec('squats', '2026-10-12T10:00:00', 15), rec('squats', '2026-10-16T10:00:00', 25)];
  const tiles = byExercise(log, [ex('squats', 30)], range);
  assert.equal(tiles[0].spark.length, bucketSets(log, range).length);
  assert.deepEqual(tiles[0].spark, [15, 0, 0, 0, 25]);
});

test('goalDays считает дни, где цель взята', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-12T10:00:00', 30),
    rec('squats', '2026-10-13T10:00:00', 12),
    rec('squats', '2026-10-14T10:00:00', 15),
    rec('squats', '2026-10-14T18:00:00', 15)
  ];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].goalDays, 2);
  assert.equal(tiles[0].activeDays, 3);
});

test('deltaPercent равен null, когда в прошлом периоде пусто', () => {
  const now = AT('2026-10-16T20:00:00');
  const tiles = byExercise([rec('squats', '2026-10-14T10:00:00', 20)], [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].deltaPercent, null);
});

test('deltaPercent округляется до целого', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-06T10:00:00', 100), rec('squats', '2026-10-14T10:00:00', 150)];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].deltaPercent, 50);
});

test('календарь — пять недель по семь дней, последняя содержит сегодня', () => {
  const now = AT('2026-10-16T20:00:00');
  const weeks = calendarWeeks([], now);
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.equal(weeks[0][0].key, '2026-09-14');
  assert.equal(weeks[4][4].key, '2026-10-16');
});

test('дни после сегодня помечены inFuture', () => {
  const now = AT('2026-10-16T20:00:00');
  const weeks = calendarWeeks([], now);
  assert.equal(weeks[4][4].inFuture, false);
  assert.equal(weeks[4][5].inFuture, true);
  assert.equal(weeks[4][6].inFuture, true);
});

test('календарь считает подходы за день', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-14T10:00:00', 10), rec('pushups', '2026-10-14T11:00:00', 10)];
  const weeks = calendarWeeks(log, now);
  assert.equal(weeks[4][2].sets, 2);
});

test('запись на несуществующее упражнение не создаёт плитку и не роняет расчёт', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('удалённое', '2026-10-14T10:00:00', 20), rec('squats', '2026-10-14T10:00:00', 20)];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.deepEqual(tiles.map((t) => t.id), ['squats']);
  assert.equal(tiles[0].total, 20);
});

test('упражнение в секундах доезжает без искажений', () => {
  const now = AT('2026-10-16T20:00:00');
  const plank = { id: 'plank', name: 'Планка', unit: 'seconds', target: 120, perSet: 60, enabled: true };
  const log = [{ id: 'p', exerciseId: 'plank', unit: 'seconds', amount: 60, completedAt: '2026-10-14T10:00:00' }];
  const tiles = byExercise(log, [plank], periodRange('week', now));
  assert.equal(tiles[0].unit, 'seconds');
  assert.equal(tiles[0].total, 60);
});

test('часовой бакет несёт номер часа ключом, а подпись — самим часом', () => {
  const now = AT('2026-10-16T20:00:00');
  const buckets = bucketSets([], periodRange('day', now));
  assert.equal(buckets[0].key, 0);
  assert.equal(buckets[23].key, 23);
  assert.equal(buckets[9].label, '9');
});

test('подходы вне диапазона в бакеты не попадают', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-11T23:59:00', 10),  // воскресенье перед неделей
    rec('squats', '2026-10-12T00:00:00', 10),  // первая минута недели
    rec('squats', '2026-10-17T00:00:00', 10)   // завтра
  ];
  const buckets = bucketSets(log, periodRange('week', now));
  assert.deepEqual(buckets.map((b) => b.sets), [1, 0, 0, 0, 0]);
});

test('итог плитки не включает подходы предыдущего периода', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-06T10:00:00', 100), rec('squats', '2026-10-14T10:00:00', 150)];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].total, 150);
  assert.equal(tiles[0].sets, 1);
});

test('в воскресенье календарь заканчивается этой же неделей', () => {
  const now = AT('2026-10-18T20:00:00');
  const weeks = calendarWeeks([], now);
  assert.equal(weeks[4][0].key, '2026-10-12');
  assert.equal(weeks[4][6].key, '2026-10-18');
  assert.equal(weeks[4][6].inFuture, false);
});

test('deltaPercent округляется, а не обрезается: 66,7 процента даёт 67', () => {
  const now = AT('2026-10-16T20:00:00');
  const log = [rec('squats', '2026-10-06T10:00:00', 3), rec('squats', '2026-10-14T10:00:00', 5)];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].deltaPercent, 67);
});

test('deltaPercent не берёт в прошлый период записи из зазора после обрезки', () => {
  // В пятницу прошлая неделя обрезана по пятницу: суббота 10 октября уже не её часть.
  const now = AT('2026-10-16T20:00:00');
  const log = [
    rec('squats', '2026-10-09T10:00:00', 100),  // прошлая пятница, входит
    rec('squats', '2026-10-10T10:00:00', 100),  // прошлая суббота, за обрезкой
    rec('squats', '2026-10-14T10:00:00', 100)
  ];
  const tiles = byExercise(log, [ex('squats', 30)], periodRange('week', now));
  assert.equal(tiles[0].deltaPercent, 0);
});
