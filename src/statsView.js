import { periodRange, summarize } from './stats.js';
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

function statsHeader() {
  return `<header class="page-header compact-header"><div><p class="eyebrow">УПРАЖНЕНИЯ</p><h1>Статистика</h1></div>${periodSwitcher()}</header>`;
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

export function renderStats(state) {
  const view = document.querySelector('#view-stats');
  const log = state.exerciseLog || [];
  if (!log.length) {
    view.innerHTML = '<div class="empty-state">Здесь появится статистика, когда наберутся первые подходы.</div>';
    return;
  }

  // Момент берётся один раз на всю отрисовку. Два вызова new Date() могли бы
  // разойтись через полночь, и границы периода не сошлись бы с серией.
  const now = new Date();
  const range = periodRange(period, now, log);
  const summary = summarize(log, state.exercises || [], range, now);

  view.innerHTML = statsHeader() + metricRow(summary);
}

export function bindStats({ getState, rerender }) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-period]');
    if (!button || button.dataset.statsPeriod === period) return;
    period = button.dataset.statsPeriod;
    rerender();
  });
}
