import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, periodRange, streakDays, summarize, GRAIN_WEEK_THRESHOLD_DAYS } from '../src/stats.js';

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
