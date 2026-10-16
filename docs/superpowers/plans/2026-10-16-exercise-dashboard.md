# Дашборд статистики упражнений — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая вкладка «Статистика», показывающая регулярность, объём и выполнение целей по упражнениям за день, неделю, месяц и всё время.

**Architecture:** Вся арифметика — чистые функции в `src/stats.js`, покрытые `node --test`. Отрисовка — `src/statsView.js`, получает готовые числа и выдаёт разметку с ручным SVG. Главный процесс, `preload.cjs` и `lib/` не затрагиваются: экран только читает уже существующий `exerciseLog`.

**Tech Stack:** ES-модули без сборщика, Electron 43.2.0, ручной SVG, `node:test`. Зависимостей ноль и не прибавляется.

**Spec:** `docs/superpowers/specs/2026-10-16-exercise-dashboard-design.md`

## Global Constraints

Действуют во всех задачах.

- `GRAIN_WEEK_THRESHOLD_DAYS = 70` — выше этого размаха шаг графика становится недельным.
- Неделя начинается с понедельника. Везде, без исключений.
- Календарь регулярности — ровно 5 недель, всегда, независимо от выбранного периода.
- Заливка календаря по подходам за день: `0`, `1–2`, `3–5`, `6 и больше`.
- Главный график считает **подходы** (число записей), а не повторения.
- Периоды: `'day' | 'week' | 'month' | 'all'`.
- Предыдущий период обрезается по длине прожитой части текущего.
- Упражнения с `target` меньше единицы или без него выбрасываются из числителя и знаменателя доли целей.
- `name`, `unit`, `target` берутся из `state.exercises`, никогда из записи лога.
- Выключенное упражнение остаётся на экране, если за период есть записи.
- Внешние скрипты запрещены CSP (`script-src 'self'`). Библиотек графиков нет и не будет.
- `main.cjs`, `preload.cjs`, `lib/**` не трогаются ни в одной задаче.
- Все строки интерфейса проходят `/humanizer-ru` в задаче 7. Род пользователя не проявляется нигде.
- Одна задача — один коммит.

## Review Focus

Пять мест, где спека молчит, а человек напорется. Для каждого указана задача, которая его закрывает.

1. **Запись с непригодным `completedAt`.** `dayKey` вернёт `null`, запись попадёт в несуществующий бакет и исказит все суммы. Ожидание: такая запись просто игнорируется. → задача 1.
2. **Раскрытая плитка при смене периода.** Упражнение могло не иметь записей в новом периоде. Ожидание: плитка остаётся раскрытой и показывает нули, а не исчезает и не роняет экран. → задача 6.
3. **Внешнее обновление состояния.** Подход, записанный из всплывающего окна, вызывает `renderApp()` и перерисовывает статистику. Ожидание: выбранный период и раскрытая плитка переживают перерисовку. → задача 4.
4. **Ни одного упражнения с записями.** Знаменатель доли целей равен нулю. Ожидание: показываем ноль из нуля без `NaN`, а не делим. → задача 2.
5. **`amount` не число.** Лог нормализуется при загрузке, но функции статистики вызываются и на свежесохранённом состоянии. Ожидание: нечисловое количество считается нулём и не превращает сумму в `NaN`. → задача 3.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `src/stats.js` | Даты, периоды, группировка, серии, дельты. Без DOM |
| `src/statsView.js` | Разметка, SVG, обработчики. Без арифметики |
| `test/stats.test.mjs` | Проверки первого файла |
| `src/index.html` | Кнопка навигации и пустая секция вида |
| `src/app.js` | Импорт, вызов отрисовки, вызов привязки обработчиков |
| `src/styles.css` | Стили экрана |
| `src/petRenderer.js` | Иконка `chart` |

---

### Task 1: Даты и границы периодов

**Files:**
- Create: `src/stats.js`
- Create: `test/stats.test.mjs`
- Modify: `package.json` (скрипт `test`)

**Interfaces:**
- Consumes: ничего.
- Produces: `GRAIN_WEEK_THRESHOLD_DAYS` (число), `dayKey(value) -> string|null`, `periodRange(period, now, log = []) -> { from: Date, to: Date, grain: 'hour'|'day'|'week', previous: { from: Date, to: Date }|null }`.

`from` — начало суток, `to` — конец суток (23:59:59.999). Все даты локальные.

- [ ] **Step 1: Написать падающие тесты**

```js
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

test('день — одни сутки, шаг часовой, предыдущий день вчера', () => {
  const r = periodRange('day', AT('2026-10-16T14:00:00'));
  assert.equal(r.grain, 'hour');
  assert.equal(dayKey(r.from), '2026-10-16');
  assert.equal(dayKey(r.to), '2026-10-16');
  assert.equal(dayKey(r.previous.from), '2026-10-15');
  assert.equal(dayKey(r.previous.to), '2026-10-15');
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
  const log = [entry('2026-09-21T13:14:16.904Z'), entry('2026-10-16T05:50:07.522Z')];
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
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test test/stats.test.mjs`
Expected: FAIL, модуль `../src/stats.js` не найден.

- [ ] **Step 3: Реализовать в `src/stats.js`**

Экспортировать `GRAIN_WEEK_THRESHOLD_DAYS = 70`, `dayKey(value)`, `periodRange(period, now, log = [])`.

`dayKey` повторяет `localDayKey` из `lib/exercises.cjs`: год, месяц и день локальной даты через дефис, `null` при `Number.isNaN(date.getTime())`. Дублирование намеренное, общий импорт между CommonJS-процессом и ES-модулями рендерера невозможен.

Понедельник недели: `(date.getDay() + 6) % 7` даёт число дней, которые надо отнять.

Обрезка предыдущего периода: посчитать, сколько суток прожито в текущем (от `from` до `to` включительно), отложить столько же от начала предыдущего периода и зажать результат его последним днём.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/stats.test.mjs`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Добавить файл в `npm test`**

В `package.json` дописать ` && node --test test/stats.test.mjs` в конец скрипта `test`.

- [ ] **Step 6: Коммит**

```bash
git add src/stats.js test/stats.test.mjs package.json
git commit -m "Добавить расчёт границ периодов статистики"
```

---

### Task 2: Серии и сводка

**Files:**
- Modify: `src/stats.js`
- Modify: `test/stats.test.mjs`

**Interfaces:**
- Consumes: `dayKey`, `periodRange` из задачи 1.
- Produces: `streakDays(log, now) -> number`, `summarize(log, exercises, range, now) -> { sets, activeDays, totalDays, streak, goalsHit, goalsPossible, deltaSets }`.

`range` — результат `periodRange`. `deltaSets` равен `null`, когда `range.previous` равен `null`.

- [ ] **Step 1: Написать падающие тесты**

```js
const ex = (id, target) => ({ id, name: id, unit: 'reps', target, perSet: 10, enabled: true });
const rec = (exerciseId, iso, amount) => ({ id: `${exerciseId}-${iso}`, exerciseId, name: exerciseId, unit: 'reps', amount, completedAt: iso });

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
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test test/stats.test.mjs`
Expected: FAIL, `streakDays is not a function`.

- [ ] **Step 3: Реализовать `streakDays` и `summarize` в `src/stats.js`**

Серия: собрать множество дней с записями, начать с сегодня, при отсутствии сегодня сдвинуться на вчера и считать оттуда, затем идти назад, пока день присутствует.

Доля целей: сгруппировать суммы по паре «день и `exerciseId`», отбросить упражнения с `target` меньше единицы, сравнить каждую сумму с `target` этого упражнения.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/stats.test.mjs`
Expected: PASS, 23 теста.

- [ ] **Step 5: Коммит**

```bash
git add src/stats.js test/stats.test.mjs
git commit -m "Добавить расчёт серий и сводки по периоду"
```

---

### Task 3: Группировка, разрез по упражнениям, календарь

**Files:**
- Modify: `src/stats.js`
- Modify: `test/stats.test.mjs`

**Interfaces:**
- Consumes: `dayKey`, `periodRange` из задачи 1.
- Produces:
  - `bucketSets(log, range) -> [{ key: string|number, label: string, sets: number }]`
  - `byExercise(log, exercises, range) -> [{ id, name, unit, target, total, sets, spark: number[], deltaPercent: number|null, goalDays: number, activeDays: number }]`
  - `calendarWeeks(log, now, weeks = 5) -> [[{ key: string, sets: number, inFuture: boolean }]]`

`spark` выровнен по индексам с результатом `bucketSets` для того же `range`.

- [ ] **Step 1: Написать падающие тесты**

```js
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
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test test/stats.test.mjs`
Expected: FAIL, `bucketSets is not a function`.

- [ ] **Step 3: Реализовать `bucketSets`, `byExercise`, `calendarWeeks` в `src/stats.js`**

Общий приём: сначала построить пустой список бакетов по `range.grain`, потом разложить записи по ключам. Запись без пригодного `dayKey` отбрасывается до раскладки. Количество приводится через `Number.isFinite`, иначе ноль.

`byExercise` считает текущий период и `range.previous` одним проходом по логу, чтобы не ходить по нему дважды.

Подпись недельного бакета — «ДД.ММ» даты понедельника.

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS, все файлы зелёные, в `stats.test.mjs` 41 тест.

- [ ] **Step 5: Коммит**

```bash
git add src/stats.js test/stats.test.mjs
git commit -m "Добавить группировку подходов и разрез по упражнениям"
```

---

### Task 4: Вкладка, иконка, метрики

**Files:**
- Create: `src/statsView.js`
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `src/petRenderer.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `summarize`, `periodRange` из задач 1–2.
- Produces: `renderStats(state) -> void`, `bindStats({ getState, rerender }) -> void`.

`rerender` — функция без аргументов, вызывается при смене периода. Выбранный период и раскрытая плитка живут в модульных переменных `src/statsView.js` и переживают перерисовку: `renderApp()` вызывается при каждом внешнем обновлении состояния.

- [ ] **Step 1: Добавить иконку `chart` в `src/petRenderer.js`**

В объект `paths` внутри `icon()`, рядом с `history`. Столбчатая диаграмма в том же стиле, что соседи: обводка 1.6, без заливки, в сетке 24×24.

- [ ] **Step 2: Добавить вкладку и секцию в `src/index.html`**

Кнопка навигации между «Упражнения» и «История»:

```html
<button class="nav-item" data-view="stats"><span class="nav-icon" data-nav-icon="chart"></span><span>Статистика</span></button>
```

Секция вида после `view-exercises`:

```html
<section class="view" id="view-stats" data-view-panel="stats"></section>
```

Содержимое секции целиком генерирует `renderStats`, поэтому в разметке она пустая.

- [ ] **Step 3: Реализовать шапку и метрики в `src/statsView.js`**

Модульные переменные `period` (начальное значение `'week'`) и `expandedId` (начальное `null`).

`renderStats(state)` строит в `#view-stats`: надзаголовок «УПРАЖНЕНИЯ», заголовок «Статистика», переключатель из четырёх кнопок с `data-stats-period`, ряд из четырёх карточек метрик.

Карточки по спеке: «Подходов» с дельтой, «Дней с занятиями» как `activeDays` из `totalDays`, «Подряд» в днях, «Цели закрыты» как `goalsHit` из `goalsPossible` с подписью «из упражнений, за которые брались».

Если записей нет вообще, вместо всего содержимого выводится одно сообщение: «Здесь появится статистика, когда наберутся первые подходы.»

Числительные через `pluralize` из `./petRenderer.js`. Экранирование значений — как в `src/exercises.js`.

`bindStats({ getState, rerender })` вешает один обработчик на `document`, ловит `[data-stats-period]`, записывает период в модульную переменную и вызывает `rerender`.

- [ ] **Step 4: Подключить в `src/app.js`**

Импорт `renderStats` и `bindStats` рядом с импортом `./exercises.js`. Вызов `renderStats(state)` в `renderApp()` перед `renderPreferences()`. Вызов `bindStats({ getState: () => state, rerender: renderApp })` в `init()` рядом с `bindExercises`.

- [ ] **Step 5: Стили в `src/styles.css`**

Переключатель периода, сетка метрик. Палитра только из токенов `src/brand.css`: `--navy`, `--gold`, `--card`, `--mist`, `--muted`, `--line`, `--sand`.

- [ ] **Step 6: Проверить в запущенном приложении**

Run: `npm start`
Expected: вкладка «Статистика» открывается, метрики заполнены настоящими числами, переключение периода меняет их, никаких `NaN` и `undefined` на экране.

- [ ] **Step 7: Коммит**

```bash
git add src/statsView.js src/index.html src/app.js src/petRenderer.js src/styles.css
git commit -m "Добавить вкладку статистики с метриками периода"
```

---

### Task 5: График подходов и календарь регулярности

**Files:**
- Modify: `src/statsView.js`
- Modify: `src/styles.css`
- Modify: `src/brand.css` (два оттенка для календаря)

**Interfaces:**
- Consumes: `bucketSets`, `calendarWeeks` из задачи 3.
- Produces: ничего нового наружу, `renderStats` обрастает двумя блоками.

- [ ] **Step 1: Нарисовать график подходов**

Блок под метриками. Заголовок зависит от `range.grain`: «Подходы по часам», «Подходы по дням», «Подходы по неделям».

Столбики из `bucketSets`, масштаб по максимуму в наборе. Сегодняшний столбик (`key` равен `dayKey(now)`, для часового шага — текущий час) красится в `--gold`, остальные в `--navy`. Пустые бакеты занимают своё место на оси без столбика.

Высота SVG фиксированная, ширина резиновая через `viewBox` и `width="100%"`.

Если в периоде ноль подходов, вместо осей выводится подпись «За этот период подходов нет».

Атрибуты доступности: `role="img"` и `aria-label` с кратким содержанием на SVG.

- [ ] **Step 2: Нарисовать календарь регулярности**

Блок под графиком. Пять недель из `calendarWeeks(log, now)`, подписи дней «пн вт ср чт пт сб вс», слева дата понедельника каждой недели.

Заливка по порогам из Global Constraints: `0` — `--mist`, `1–2` — светлый синий, `3–5` — средний синий, `6 и больше` — `--navy`. Два промежуточных оттенка вывести из `--navy`, добавив их в `src/brand.css` как `--navy-soft` и `--navy-mid`, чтобы они не были случайными числами в разметке.

Сегодняшняя ячейка получает рамку `--gold`. Ячейки с `inFuture` — пунктирная рамка без заливки.

- [ ] **Step 3: Проверить в запущенном приложении**

Run: `npm start`
Expected: на «Неделе» пять столбиков, на «Месяце» шестнадцать, на «Дне» двадцать четыре часовых; календарь показывает пропуски 26 и 27 сентября, 30 сентября, 4, 10 и 11 октября; сегодняшняя ячейка выделена.

- [ ] **Step 4: Коммит**

```bash
git add src/statsView.js src/styles.css src/brand.css
git commit -m "Нарисовать график подходов и календарь регулярности"
```

---

### Task 6: Плитки упражнений и раскрытие

**Files:**
- Modify: `src/statsView.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `byExercise`, `bucketSets` из задачи 3.
- Produces: ничего нового наружу.

- [ ] **Step 1: Нарисовать плитки**

Сетка по три в ряд под календарём. В плитке: имя, значок направления с процентом, итог за период крупно, спарклайн из `spark`, подпись «Цель закрыта: N из M дней» со склонением через `pluralize`.

Направление: при `deltaPercent` больше нуля — зелёный, меньше нуля — красный, при `null` и ненулевом итоге — «новое», при нулевом итоге — ничего.

Единица в подписи итога: «раз» при `unit === 'reps'`, «сек.» при `'seconds'`.

Упражнение без записей за период остаётся плиткой с нулём и ровной линией: иначе сетка прыгает при смене периода.

- [ ] **Step 2: Сделать раскрытие**

Плитка получает `data-stats-tile="<id>"`. Обработчик в `bindStats` переключает `expandedId`: клик по раскрытой плитке сворачивает её, клик по другой переносит раскрытие. Раскрыта не больше одной.

Раскрытая плитка занимает всю ширину сетки и показывает крупный график по бакетам периода: столбики из `spark`, подписи оси из `bucketSets`, пунктирная горизонтальная линия на уровне `target` с подписью «цель N».

- [ ] **Step 3: Проверить поведение, которое легко сломать**

Run: `npm start`
Expected, по шагам:
1. Раскрыть плитку, переключить период на «День» — плитка остаётся раскрытой и показывает нули, экран не падает.
2. Раскрыть плитку, записать подход на экране «Упражнения», вернуться — период и раскрытие сохранились.
3. Переключить период на «Всё время» — шаг остался дневным (данных меньше 70 дней), плиток шесть.

- [ ] **Step 4: Коммит**

```bash
git add src/statsView.js src/styles.css
git commit -m "Добавить плитки упражнений с раскрытием"
```

---

### Task 7: Тексты, документация, проверка на собранном приложении

**Files:**
- Modify: `src/statsView.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Прогнать все строки экрана через `/humanizer-ru`**

Собрать в один список каждую видимую строку из `src/statsView.js`, включая подписи осей, пустые состояния и `aria-label`. Проверять в первую очередь род пользователя: формулировок вроде «занимался» быть не должно.

- [ ] **Step 2: Применить правки и прогнать тесты**

Run: `npm test`
Expected: PASS, правка текстов не трогает арифметику.

- [ ] **Step 3: Описать в `CHANGELOG.md` и `README.md`**

В `CHANGELOG.md`, в существующий раздел «Не выпущено», добавить подраздел про статистику: что показывает, какие четыре периода, почему главный график считает подходы, а не повторения.

В `README.md`, в список «Что умеет», один пункт про статистику упражнений.

- [ ] **Step 4: Собрать и проверить сборку**

Run: `npm run dist:mac`
Expected: сборка проходит, `dist/mac-arm64/Напоминалка.app` открывается, вкладка «Статистика» работает на настоящих данных.

Перед проверкой снять копию `~/Library/Application Support/Напоминалка/napominalka.json`, после — сверить, что файл не изменился: экран только читает, записи быть не должно.

- [ ] **Step 5: Коммит**

```bash
git add src/statsView.js README.md CHANGELOG.md
git commit -m "Описать статистику и поправить её тексты"
```

---

## Распределение по агентам

| Задача | Кто | Почему |
| --- | --- | --- |
| 1, 2, 3 | Sonnet 5.5, по одному агенту на задачу, последовательно | Тесты и сигнатуры выписаны полностью, решений не осталось. Задачи идут подряд в одном файле, параллелить нельзя |
| 4 | Основная сессия | Трогает четыре существующих файла и схему состояния экрана |
| 5, 6 | Sonnet 5.5 | Отрисовка по описанным данным, арифметики нет |
| 7 | Основная сессия | Хуманайзер и проверка на собранном приложении |

Haiku не задействован: в каждой задаче есть либо вёрстка по макету, либо решения о формулировках.
