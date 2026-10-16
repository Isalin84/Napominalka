import { periodRange, summarize, bucketSets, byExercise, calendarWeeks, dayKey } from './stats.js';
// В метриках склонение берётся из `plural`: число там набрано крупно и отдельно
// от слова, а `pluralize` склеивает их в одну строку. В подписях плиток число
// и слово идут подряд, и там нужен как раз `pluralize`.
import { plural, pluralize } from './petRenderer.js';
// Имена упражнений задаёт человек, в разметку они попадают только экранированными.
// Своей копии экранирования здесь нет: она одна, в exercises.js.
import { escape as escapeHtml, quantity } from './exercises.js';

// Выбранное на экране живёт в модуле, а не в разметке: renderApp() перерисовывает
// все виды при каждом обновлении состояния, в том числе когда подход записан из
// всплывающего окна. В DOM такой выбор не пережил бы ни одной перерисовки.
let period = 'week';
// Раскрытая плитка упражнения: такой же выбор пользователя, как период, и
// переживает перерисовку так же. Хранится идентификатор, а не признак на плитке:
// при смене периода плитка пересобирается, и признак в разметке пропал бы вместе с ней.
let expandedId = null;

const PERIODS = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё время' }
];

// Прошлый период называется словами, по одному набору на период. «К прошлому
// периоду» звучит как язык кода: вчера, прошлая неделя и прошлый месяц разные.
// У «Всего времени» прошлого периода нет, поэтому его здесь и не ищут.
const PREVIOUS_PERIOD = {
  day: { delta: 'к этому времени вчера', same: 'столько же, сколько вчера к этому времени' },
  week: { delta: 'к тем же дням прошлой недели', same: 'столько же, сколько за те же дни прошлой недели' },
  month: { delta: 'к тем же дням прошлого месяца', same: 'столько же, сколько за те же дни прошлого месяца' }
};

function periodSwitcher() {
  const buttons = PERIODS.map(({ id, label }) => {
    const active = id === period;
    return `<button class="stats-period${active ? ' is-active' : ''}" type="button" data-stats-period="${id}" aria-pressed="${active}">${label}</button>`;
  }).join('');
  return `<div class="stats-periods" role="group" aria-label="Период статистики">${buttons}</div>`;
}

// На пустом экране шапка идёт без переключателя: переключать нечего.
function statsHeader(aside = '') {
  return `<header class="page-header compact-header"><div><p class="eyebrow">УПРАЖНЕНИЯ</p><h1>Статистика</h1></div>${aside}</header>`;
}

function metricCard({ label, value, unit, caption }) {
  return `<article class="stats-metric"><div class="stats-metric-label">${label}</div><div class="stats-metric-value"><strong>${value}</strong>${unit ? `<span class="stats-metric-unit">${unit}</span>` : ''}</div><div class="stats-metric-caption">${caption || ''}</div></article>`;
}

function deltaCaption(deltaSets) {
  const labels = PREVIOUS_PERIOD[period];
  if (deltaSets === null || !labels) return '';
  if (deltaSets === 0) return labels.same;
  // Настоящий минус, а не дефис: в колонке цифр дефис читается как перенос.
  return `${deltaSets > 0 ? '+' : '−'}${Math.abs(deltaSets)} ${labels.delta}`;
}

function metricRow(summary) {
  const cards = [
    metricCard({ label: 'Подходов', value: summary.sets, caption: deltaCaption(summary.deltaSets) }),
    metricCard({ label: 'Дней с занятиями', value: summary.activeDays, unit: `из ${summary.totalDays}` }),
    metricCard({ label: 'Без пропусков', value: summary.streak, unit: plural(summary.streak, 'день', 'дня', 'дней') }),
    metricCard({
      label: 'Цели закрыты',
      value: summary.goalsHit,
      unit: `из ${summary.goalsPossible}`,
      caption: 'среди упражнений, за которые брались'
    })
  ];
  return `<section class="stats-metric-grid" aria-label="Итоги за период">${cards.join('')}</section>`;
}

// Размеры графика в единицах viewBox, а не в пикселях: ширина резиновая, и
// всё нарисованное масштабируется вместе с ней. Высота viewBox одна на все шаги.
const CHART = { width: 800, height: 200, top: 22, bottom: 26, side: 8, maxBarWidth: 44, minBarHeight: 2 };
// Сколько места в единицах viewBox нужно подписи оси: «21.09» шире, чем «14».
const LABEL_WIDTH = { hour: 18, day: 18, week: 36 };
// Число над столбиком убирается, когда столбики слишком узки для него. В крупном
// графике плитки это повторения, а не подходы: «120» при кегле 10 занимает около 17.
const VALUE_MIN_SLOT = 22;

const CHART_TITLES = { hour: 'Подходы по часам', day: 'Подходы по дням', week: 'Подходы по неделям' };
const CHART_STEP = { hour: 'час', day: 'день', week: 'неделю' };

const setsWord = (count) => plural(count, 'подход', 'подхода', 'подходов');

// 'YYYY-MM-DD' -> 'ДД.ММ'. Ключ уже собран в stats.js, здесь он только переписывается.
const shortDate = (key) => `${key.slice(8)}.${key.slice(5, 7)}`;

// Как шаг называется в подсказке. Подпись оси для этого не годится: на дневном
// шаге это голое число месяца, и «16: 3 подхода» не говорит, какой это месяц, —
// а на «Всём времени» ось переходит из сентября в октябрь без единой пометки.
// В самой подписи оси месяца по-прежнему нет: там тесно.
function stepTitle(step, grain) {
  if (grain === 'hour') return `${step.label}:00`;
  return grain === 'day' ? shortDate(step.key) : step.label;
}

// Какой столбик «сейчас». У недельного шага ключ это понедельник, и с сегодняшним
// днём он совпал бы раз в неделю, поэтому берётся последний: диапазон всегда
// кончается сегодняшним днём, значит, в последнем шаге он и лежит.
function currentBarIndex(bars, grain, now) {
  if (grain === 'hour') return bars.findIndex((bar) => bar.key === now.getHours());
  if (grain === 'day') return bars.findIndex((bar) => bar.key === dayKey(now));
  return bars.length - 1;
}

// Столбики по шагам периода. Общий для графика подходов и для крупного графика
// плитки: шаги, ось и подписи там одни и те же, различаются значения и подписи к ним.
// Значения приходят отдельным массивом по индексам шагов, как их отдаёт byExercise.
function barChart({ steps, values, grain, now, ariaFor, titleFor, target = null }) {
  const { width, height, top, bottom, side } = CHART;
  const baseline = height - bottom;
  const plotHeight = baseline - top;
  const slot = (width - side * 2) / steps.length;
  const barWidth = Math.min(slot * 0.64, CHART.maxBarWidth);
  const highest = Math.max(...values);
  // Цель входит в масштаб: иначе при столбиках ниже цели линия ушла бы за график.
  const hasTarget = Number.isFinite(target) && target > 0;
  const peak = hasTarget ? Math.max(highest, target) : highest;
  const current = currentBarIndex(steps, grain, now);
  // Подписи прореживаются от последней: текущий шаг должен остаться подписанным.
  const labelEvery = Math.ceil(LABEL_WIDTH[grain] / slot);

  const parts = steps.map((step, index) => {
    const center = side + slot * index + slot / 2;
    const value = values[index];
    let markup = '';
    // Пустой шаг не рисуется вовсе: пропуск должен читаться провалом на оси.
    if (value > 0) {
      // Единица при большом максимуме иначе стала бы невидимой и выглядела бы пропуском.
      const barHeight = Math.max((value / peak) * plotHeight, CHART.minBarHeight);
      const stepName = stepTitle(step, grain);
      markup += `<rect class="stats-bar${index === current ? ' is-today' : ''}" x="${(center - barWidth / 2).toFixed(1)}" y="${(baseline - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${titleFor(stepName, value)}</title></rect>`;
      if (slot >= VALUE_MIN_SLOT) {
        markup += `<text class="stats-chart-value" x="${center.toFixed(1)}" y="${(baseline - barHeight - 5).toFixed(1)}" text-anchor="middle">${value}</text>`;
      }
    }
    if ((steps.length - 1 - index) % labelEvery === 0) {
      markup += `<text class="stats-chart-label" x="${center.toFixed(1)}" y="${baseline + 16}" text-anchor="middle">${step.label}</text>`;
    }
    return markup;
  });

  // Линия цели рисуется поверх столбиков, чтобы пересечение читалось.
  let goal = '';
  if (hasTarget) {
    const y = baseline - (target / peak) * plotHeight;
    goal = `<line class="stats-chart-target" x1="${side}" y1="${y.toFixed(1)}" x2="${width - side}" y2="${y.toFixed(1)}"/><text class="stats-chart-target-label" x="${side}" y="${(y - 5).toFixed(1)}" text-anchor="start">цель ${target}</text>`;
  }

  return `<svg class="stats-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${ariaFor(highest)}"><line class="stats-chart-axis" x1="${side}" y1="${baseline}" x2="${width - side}" y2="${baseline}"/>${parts.join('')}${goal}</svg>`;
}

function chartSvg(bars, grain, now, summary) {
  return barChart({
    steps: bars,
    values: bars.map((bar) => bar.sets),
    grain,
    now,
    ariaFor: (peak) => `${CHART_TITLES[grain]}: всего ${summary.sets} ${setsWord(summary.sets)}, больше всего ${peak} за ${CHART_STEP[grain]}`,
    titleFor: (stepName, value) => `${stepName}: ${value} ${setsWord(value)}`
  });
}

function setsChart(log, range, summary, now) {
  const bars = bucketSets(log, range);
  const hasSets = bars.some((bar) => bar.sets > 0);
  // Вместо осей одна подпись: пустой график с шкалой от нуля до нуля ничего не говорит.
  const body = hasSets
    ? chartSvg(bars, range.grain, now, summary)
    : '<p class="stats-block-empty">За этот период подходов нет</p>';
  return `<section class="stats-block"><h2 class="stats-block-title">${CHART_TITLES[range.grain]}</h2>${body}</section>`;
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

// Пороги заливки: 0, 1–2, 3–5, 6 и больше. Это раскладка по корзинам для цвета,
// счёт подходов остаётся в stats.js.
function dayLevel(sets) {
  if (sets === 0) return 0;
  if (sets <= 2) return 1;
  if (sets <= 5) return 2;
  return 3;
}

function calendarCell(day, todayKey) {
  const date = shortDate(day.key);
  if (day.inFuture) {
    return `<td class="stats-day is-future"><span class="sr-only">${date}, день ещё не наступил</span></td>`;
  }
  const today = day.key === todayKey;
  // Число в клетке нужно тем, кто не различает оттенки; пустая клетка остаётся пустой.
  const count = day.sets > 0 ? day.sets : '';
  // «Сегодня» видно по золотой рамке, но золото на белом даёт контраст 2,1:1,
  // поэтому для скринридера оно сказано словом. Подпись одна: title рядом с
  // sr-only часть скринридеров прочитала бы дважды.
  return `<td class="stats-day level-${dayLevel(day.sets)}${today ? ' is-today' : ''}"><span class="sr-only">${date}: ${day.sets} ${setsWord(day.sets)}${today ? ', сегодня' : ''}</span><span aria-hidden="true">${count}</span></td>`;
}

// Календарь показывает пять недель всегда, что бы ни было выбрано в переключателе:
// это взгляд на регулярность, а не на период.
function regularityCalendar(log, now) {
  const weeks = calendarWeeks(log, now);
  const todayKey = dayKey(now);
  const head = WEEKDAYS.map((name) => `<th scope="col">${name}</th>`).join('');
  const rows = weeks
    .map((week) => `<tr><th scope="row">${shortDate(week[0].key)}</th>${week.map((day) => calendarCell(day, todayKey)).join('')}</tr>`)
    .join('');
  return `<section class="stats-block"><h2 class="stats-block-title">Регулярность</h2><p class="stats-block-note">Подходов в день за последние пять недель</p><table class="stats-calendar"><thead><tr><th scope="col"><span class="sr-only">Неделя с</span></th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

// Спарклайн плитки в единицах viewBox: ширина резиновая (preserveAspectRatio="none"),
// толщина линии от растяжения не зависит (non-scaling-stroke в стилях).
const SPARK = { width: 120, height: 32, pad: 3 };

// Нулевой ряд даёт ровную линию по низу, а не пустое место: плитка без записей
// должна занимать столько же, сколько с записями, иначе сетка прыгает при смене периода.
function sparkline(values) {
  const { width, height, pad } = SPARK;
  const peak = Math.max(...values);
  const yOf = (value) => (peak > 0 ? height - pad - (value / peak) * (height - pad * 2) : height - pad);
  const last = values.length - 1;
  const points = values.map((value, index) => [last > 0 ? (index / last) * width : 0, yOf(value)]);
  // Из одной точки линии не выйдет: растягиваем её на всю ширину.
  if (last === 0) points.push([width, points[0][1]]);
  const path = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg class="stats-spark${peak > 0 ? '' : ' is-flat'}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${path}"/></svg>`;
}

// Рост зелёный, спад красный. Цвет не единственный признак: есть стрелка и знак,
// а скринридер читает полную подпись с прошлым периодом.
function deltaBadge(tile) {
  const labels = PREVIOUS_PERIOD[period];
  // При нулевом итоге сравнивать нечего, у «Всего времени» прошлого периода нет
  // вовсе, а deltaPercent === null означает «в прошлом периоде пусто». Это «сравнить
  // не с чем», а не «такого раньше не было»: на «Месяце» прошлый период пуст у всех
  // упражнений разом, пока записей меньше чем на два месяца. Значок без направления
  // ничего не сообщает, а итог и мелкий график на плитке и так есть.
  if (tile.total === 0 || !labels || tile.deltaPercent === null) return '';
  const percent = Math.abs(tile.deltaPercent);
  if (tile.deltaPercent === 0) {
    return `<span class="stats-delta is-same" title="${labels.same}"><span aria-hidden="true">0%</span><span class="sr-only">${labels.same}</span></span>`;
  }
  const up = tile.deltaPercent > 0;
  const spoken = `${up ? '+' : '−'}${percent}% ${labels.delta}`;
  return `<span class="stats-delta ${up ? 'is-up' : 'is-down'}" title="${spoken}"><span aria-hidden="true">${up ? '▲' : '▼'} ${percent}%</span><span class="sr-only">${spoken}</span></span>`;
}

function goalCaption(tile) {
  if (tile.activeDays === 0) return 'Подходов не было';
  // Без цели «закрыта: 0» утверждало бы неправду: вместо этого просто число подходов.
  if (tile.target === null) return `${tile.sets} ${setsWord(tile.sets)}`;
  // «Из» требует родительного: «из 1 дня», «из 2 дней», «из 5 дней», «из 21 дня».
  return `Цель закрыта: ${tile.goalDays} из ${pluralize(tile.activeDays, 'дня', 'дней', 'дней')}`;
}

const BY_STEP = { hour: 'по часам', day: 'по дням', week: 'по неделям' };

// Крупный график раскрытой плитки. Подписи оси берутся из bucketSets, значения из spark:
// обе функции строят ось из одного источника, поэтому индексы совпадают.
function tileDetail(tile, detailId, steps, grain, now) {
  if (tile.total === 0) {
    return `<div class="stats-tile-detail" id="${detailId}"><p class="stats-block-empty">За этот период подходов нет</p></div>`;
  }
  // Цель дневная: на часовом и недельном шаге она сравнивалась бы с чужими по
  // масштабу суммами, а входя в масштаб, сплющила бы столбики. Там линии нет вовсе,
  // и в подписи для скринридера о цели тоже ни слова.
  const target = grain === 'day' ? tile.target : null;
  const chart = barChart({
    steps,
    values: tile.spark,
    grain,
    now,
    target,
    ariaFor: (peak) => `${escapeHtml(tile.name)}, ${BY_STEP[grain]}: всего ${quantity(tile.total, tile.unit)}, больше всего ${quantity(peak, tile.unit)} за ${CHART_STEP[grain]}${target === null ? '' : `, цель ${target}`}`,
    titleFor: (stepName, value) => `${stepName}: ${quantity(value, tile.unit)}`
  });
  return `<div class="stats-tile-detail" id="${detailId}">${chart}</div>`;
}

// Плитка это кнопка с data-stats-tile и aria-expanded внутри статьи. Раскрытие
// хранится в aria-expanded и классе, а не в data-*: paint опознаёт элемент по
// всем его data-* сразу, и изменчивый атрибут оставил бы фокус без адресата.
function exerciseTile(tile, steps, range, now) {
  const id = String(tile.id);
  const expanded = id === expandedId;
  const unit = tile.unit === 'seconds' ? 'сек.' : 'раз';
  // aria-controls называет то, что раскрывается: без него скринридер говорит
  // «развёрнуто», но не говорит, что именно. Идентификатор упражнения состоит из
  // латиницы, цифр и дефисов, так что ссылаться на блок по нему можно. У свёрнутой
  // плитки блока нет вовсе, и атрибут указывал бы в пустоту — поэтому его там нет.
  const detailId = `stats-tile-detail-${escapeHtml(id)}`;
  const head = `<button class="stats-tile-toggle" type="button" data-stats-tile="${escapeHtml(id)}" aria-expanded="${expanded}"${expanded ? ` aria-controls="${detailId}"` : ''}>`
    + `<span class="stats-tile-top"><span class="stats-tile-name">${escapeHtml(tile.name)}</span>${deltaBadge(tile)}</span>`
    + `<span class="stats-tile-total"><strong>${tile.total}</strong><span class="stats-tile-unit">${unit}</span></span>`
    // В раскрытой плитке спарклайн заменяет крупный график.
    + (expanded ? '' : sparkline(tile.spark))
    + `<span class="stats-tile-goal">${goalCaption(tile)}</span></button>`;
  return `<article class="stats-tile${expanded ? ' is-expanded' : ''}">${head}${expanded ? tileDetail(tile, detailId, steps, range.grain, now) : ''}</article>`;
}

function exerciseTiles(log, exercises, range, now) {
  const tiles = byExercise(log, exercises, range);
  if (!tiles.length) return '';
  const steps = bucketSets(log, range);
  return `<section class="stats-tiles"><h2 class="stats-block-title">Упражнения</h2><p class="stats-block-note">Нажмите на упражнение, чтобы увидеть его график</p><div class="stats-tile-grid">${tiles.map((tile) => exerciseTile(tile, steps, range, now)).join('')}</div></section>`;
}

// Значение атрибута внутри селектора: в кавычках экранируются только сами
// кавычки и обратный слэш.
const quoted = (value) => `"${String(value).replace(/["\\]/g, (character) => `\\${character}`)}"`;

// Чем элемент опознаётся после перерисовки. Ссылка на узел не годится: узла
// больше нет. А id и data-атрибуты задаёт разметка, и у нового воплощения того
// же элемента они те же. Берём все data-атрибуты сразу: по одному плитка
// упражнения и кнопка внутри неё могли бы совпасть.
function focusSelector(element) {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) return `[id=${quoted(element.id)}]`;
  const parts = Object.keys(element.dataset).map((key) => {
    const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `[data-${name}=${quoted(element.dataset[key])}]`;
  });
  return parts.length ? parts.join('') : null;
}

// Вид перерисовывается целиком при каждом обновлении состояния, и активный
// элемент исчезает вместе с разметкой: фокус уезжает на body, следующий Tab
// начинает обход заново с сайдбара, а скринридер теряет место. Для кнопок,
// которые жмут несколько раз подряд, это основной сценарий, поэтому фокус
// возвращается здесь, а не в обработчике: приём один на все элементы вида.
function paint(view, html) {
  const selector = view.contains(document.activeElement) ? focusSelector(document.activeElement) : null;
  view.innerHTML = html;
  if (!selector) return;
  // Значение data-* может оказаться таким, что селектор из него невалиден, и
  // querySelector бросит SyntaxError. paint вызывается из renderApp, и исключение
  // оборвало бы перерисовку всех остальных видов: потерянный фокус лучше упавшего экрана.
  try {
    view.querySelector(selector)?.focus();
  } catch {
    /* фокус не вернулся, разметка уже на месте */
  }
}

export function renderStats(state) {
  const view = document.querySelector('#view-stats');
  const log = state.exerciseLog || [];
  if (!log.length) {
    // Пустые оси, нули и карточки не рисуем, но название раздела остаётся:
    // вкладка с одной серой строкой выглядит сломанной, а не пустой.
    paint(view, `${statsHeader()}<div class="empty-state">Запишите первый подход, и здесь появится статистика.</div>`);
    return;
  }

  // Момент берётся один раз на всю отрисовку. Два вызова new Date() могли бы
  // разойтись через полночь, и границы периода не сошлись бы с серией.
  const now = new Date();
  const range = periodRange(period, now, log);
  const summary = summarize(log, state.exercises || [], range, now);

  paint(view, statsHeader(periodSwitcher()) + metricRow(summary) + setsChart(log, range, summary, now) + regularityCalendar(log, now) + exerciseTiles(log, state.exercises || [], range, now));
}

export function bindStats({ rerender }) {
  document.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-stats-tile]');
    if (tile) {
      // Раскрыта не больше одной: повторный клик сворачивает, клик по другой переносит.
      expandedId = tile.dataset.statsTile === expandedId ? null : tile.dataset.statsTile;
      rerender();
      return;
    }
    const button = event.target.closest('[data-stats-period]');
    if (!button || button.dataset.statsPeriod === period) return;
    period = button.dataset.statsPeriod;
    rerender();
  });
}
