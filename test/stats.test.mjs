import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, periodRange, GRAIN_WEEK_THRESHOLD_DAYS } from '../src/stats.js';

const AT = (iso) => new Date(iso);
const entry = (iso) => ({ id: iso, exerciseId: 'squats', amount: 10, unit: 'reps', completedAt: iso });

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
