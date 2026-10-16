import { periodRange, summarize, bucketSets, calendarWeeks, dayKey } from './stats.js';
// Склонение берётся из `plural`, а не из `pluralize`: число в карточке набрано
// крупно и отдельно от слова, а `pluralize` склеивает их в одну строку.
import { plural } from './petRenderer.js';

// Выбранное на экране живёт в модуле, а не в разметке: renderApp() перерисовывает
// все виды при каждом обновлении состояния, в том числе когда подход записан из
// всплывающего окна. В DOM такой выбор не пережил бы ни одной перерисовки.
let period = 'week';
// Раскрытая плитка упражнения. Плиток на экране пока нет, но место под них
// заведено здесь же: это такой же выбор пользователя, а не частный случай.
let expandedId = null;

const PERIODS = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё время' }
];

// Прошлый период называется словами, по одному набору на период. «К прошлому
// периоду» — язык кода: вчера, прошлая неделя и прошлый месяц звучат по-разному.
// У «Всего времени» прошлого периода нет, поэтому его здесь и не ищут.
const PREVIOUS_PERIOD = {
  day: { delta: 'ко вчерашнему дню', same: 'столько же, сколько вчера' },
  week: { delta: 'к прошлой неделе', same: 'столько же, сколько на прошлой неделе' },
  month: { delta: 'к прошлому месяцу', same: 'столько же, сколько в прошлом месяце' }
};

function periodSwitcher() {
  const buttons = PERIODS.map(({ id, label }) => {
    const active = id === period;
    return `<button class="stats-period ${active ? 'is-active' : ''}" type="button" data-stats-period="${id}" aria-pressed="${active}">${label}</button>`;
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
    metricCard({ label: 'Подряд', value: summary.streak, unit: plural(summary.streak, 'день', 'дня', 'дней') }),
    metricCard({
      label: 'Цели закрыты',
      value: summary.goalsHit,
      unit: `из ${summary.goalsPossible}`,
      caption: 'из упражнений, за которые брались'
    })
  ];
  return `<section class="stats-metric-grid" aria-label="Итоги за период">${cards.join('')}</section>`;
}

// Размеры графика в единицах viewBox, а не в пикселях: ширина резиновая, и
// всё нарисованное масштабируется вместе с ней. Высота viewBox одна на все шаги.
const CHART = { width: 800, height: 200, top: 22, bottom: 26, side: 8, maxBarWidth: 44, minBarHeight: 2 };
// Сколько места в единицах viewBox нужно подписи оси: «21.09» шире, чем «14».
const LABEL_WIDTH = { hour: 18, day: 18, week: 36 };
// Число над столбиком убирается, когда столбики слишком узки для него.
const VALUE_MIN_SLOT = 16;

const CHART_TITLES = { hour: 'Подходы по часам', day: 'Подходы по дням', week: 'Подходы по неделям' };
const CHART_STEP = { hour: 'час', day: 'день', week: 'неделю' };

const setsWord = (count) => plural(count, 'подход', 'подхода', 'подходов');

// Какой столбик «сейчас». У недельного шага ключ — понедельник, и с сегодняшним
// днём он совпал бы раз в неделю, поэтому берётся последний: диапазон всегда
// кончается сегодняшним днём, значит, в последнем шаге он и лежит.
function currentBarIndex(bars, grain, now) {
  if (grain === 'hour') return bars.findIndex((bar) => bar.key === now.getHours());
  if (grain === 'day') return bars.findIndex((bar) => bar.key === dayKey(now));
  return bars.length - 1;
}

function chartSvg(bars, grain, now, summary) {
  const { width, height, top, bottom, side } = CHART;
  const baseline = height - bottom;
  const plotHeight = baseline - top;
  const slot = (width - side * 2) / bars.length;
  const barWidth = Math.min(slot * 0.64, CHART.maxBarWidth);
  const peak = Math.max(...bars.map((bar) => bar.sets));
  const current = currentBarIndex(bars, grain, now);
  // Подписи прореживаются от последней: текущий шаг должен остаться подписанным.
  const labelEvery = Math.ceil(LABEL_WIDTH[grain] / slot);

  const parts = bars.map((bar, index) => {
    const center = side + slot * index + slot / 2;
    let markup = '';
    // Пустой шаг не рисуется вовсе: пропуск должен читаться провалом на оси.
    if (bar.sets > 0) {
      // Единица при большом максимуме иначе стала бы невидимой и выглядела бы пропуском.
      const barHeight = Math.max((bar.sets / peak) * plotHeight, CHART.minBarHeight);
      const stepName = grain === 'hour' ? `${bar.label}:00` : bar.label;
      markup += `<rect class="stats-bar${index === current ? ' is-today' : ''}" x="${(center - barWidth / 2).toFixed(1)}" y="${(baseline - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${stepName}: ${bar.sets} ${setsWord(bar.sets)}</title></rect>`;
      if (slot >= VALUE_MIN_SLOT) {
        markup += `<text class="stats-chart-value" x="${center.toFixed(1)}" y="${(baseline - barHeight - 5).toFixed(1)}" text-anchor="middle">${bar.sets}</text>`;
      }
    }
    if ((bars.length - 1 - index) % labelEvery === 0) {
      markup += `<text class="stats-chart-label" x="${center.toFixed(1)}" y="${baseline + 16}" text-anchor="middle">${bar.label}</text>`;
    }
    return markup;
  });

  const label = `${CHART_TITLES[grain]}: всего ${summary.sets} ${setsWord(summary.sets)}, больше всего ${peak} за ${CHART_STEP[grain]}`;
  return `<svg class="stats-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${label}"><line class="stats-chart-axis" x1="${side}" y1="${baseline}" x2="${width - side}" y2="${baseline}"/>${parts.join('')}</svg>`;
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

// 'YYYY-MM-DD' -> 'ДД.ММ'. Ключ уже собран в stats.js, здесь он только переписывается.
const shortDate = (key) => `${key.slice(8)}.${key.slice(5, 7)}`;

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
    return `<td class="stats-day is-future"><span class="sr-only">${date}: ещё не наступил</span></td>`;
  }
  const today = day.key === todayKey ? ' is-today' : '';
  // Число в клетке нужно тем, кто не различает оттенки; пустая клетка остаётся пустой.
  const count = day.sets > 0 ? day.sets : '';
  return `<td class="stats-day level-${dayLevel(day.sets)}${today}" title="${date}: ${day.sets} ${setsWord(day.sets)}"><span class="sr-only">${date}: ${day.sets} ${setsWord(day.sets)}</span><span aria-hidden="true">${count}</span></td>`;
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
  return `<section class="stats-block"><h2 class="stats-block-title">Регулярность</h2><p class="stats-block-note">Последние пять недель, подходов в день</p><table class="stats-calendar"><thead><tr><th scope="col"><span class="sr-only">Неделя с</span></th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
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
  if (selector) view.querySelector(selector)?.focus();
}

export function renderStats(state) {
  const view = document.querySelector('#view-stats');
  const log = state.exerciseLog || [];
  if (!log.length) {
    // Пустые оси, нули и карточки не рисуем, но название раздела остаётся:
    // вкладка с одной серой строкой выглядит сломанной, а не пустой.
    paint(view, `${statsHeader()}<div class="empty-state">Здесь появится статистика, когда наберутся первые подходы.</div>`);
    return;
  }

  // Момент берётся один раз на всю отрисовку. Два вызова new Date() могли бы
  // разойтись через полночь, и границы периода не сошлись бы с серией.
  const now = new Date();
  const range = periodRange(period, now, log);
  const summary = summarize(log, state.exercises || [], range, now);

  paint(view, statsHeader(periodSwitcher()) + metricRow(summary) + setsChart(log, range, summary, now) + regularityCalendar(log, now));
}

export function bindStats({ getState, rerender }) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-period]');
    if (!button || button.dataset.statsPeriod === period) return;
    period = button.dataset.statsPeriod;
    rerender();
  });
}
