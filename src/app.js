import {
  PETS,
  PET_ORDER,
  pet,
  petSprite,
  startPetAnimations,
  icon,
  plural,
  pluralize,
  formatInterval,
  formatNextTime,
  reminderText
} from './petRenderer.js';

import { renderExercises, bindExercises, quantity } from './exercises.js';
const api = window.desktopApi;
document.documentElement.dataset.platform = api.platform || 'win32';
let state;
let currentView = 'overview';
let onboardingPet = null;
let toastTimer;

const dayLabels = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' };
const dayLongLabels = { 1: 'понедельник', 2: 'вторник', 3: 'среда', 4: 'четверг', 5: 'пятница', 6: 'суббота', 7: 'воскресенье' };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function activeDay() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function isToday(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function todayHistory(key) {
  return state.history.filter((item) => item.key === key && isToday(item.completedAt));
}

function allReminderEntries() {
  const entries = [
    { id: 'water', key: 'water', type: 'water', title: 'Вода', description: 'Пара глотков, чтобы голова снова работала.', ...state.reminders.water },
    { id: 'movement', key: 'movement', type: 'movement', title: 'Разминка', description: (state.exercises || []).filter(e => e.enabled).map(e => e.name).join(', ') || 'Выберите упражнения в разделе «Упражнения»', ...state.reminders.movement }
  ];
  for (const reminder of state.customReminders) {
    entries.push({ id: reminder.id, key: reminder.id, type: 'custom', title: reminder.title, description: reminder.message || 'Своя пауза', ...reminder });
  }
  return entries;
}

function saveAndRender(message) {
  return api.saveState(state).then((nextState) => {
    state = nextState;
    renderApp();
    if (message) showToast(message);
  });
}

function getEntry(key) {
  if (state.reminders[key]) return state.reminders[key];
  return state.customReminders.find((item) => item.id === key);
}

function scheduleLabel(entry) {
  return entry.frequency === 'time' ? `в ${entry.time || '09:00'}` : formatInterval(entry.everyMinutes || 60);
}

function historyLabel(item) {
  if (item.exerciseId) return `${item.name || item.exercise || 'Упражнение'} · ${quantity(item.amount || item.amountCompleted || 0, item.unit)}`;
  if (item.type === 'movement' || item.key === 'movement') return 'Разминка';
  if (item.type === 'water' || item.key === 'water') return 'Вода';
  return item.title || item.action || 'Своя пауза';
}

function setView(view) {
  if (view !== currentView) $('#main-content').scrollTop = 0;
  currentView = view;
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.viewPanel === view));
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
}

function renderIcons() {
  $$('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon, element.dataset.icon === 'spark' ? 15 : 17); });
  $$('[data-nav-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.navIcon, 17); });
}

function renderSidebar() {
  const current = pet(state.petId);
  $('#sidebar-pet-card').innerHTML = `<div class="pet-mini-row"><div class="pet-mini-art">${petSprite(state.petId, { motion: 'idle' })}</div><div><div class="pet-mini-name">${current.name} рядом</div><div class="pet-mini-type">${current.species}</div></div></div><div class="pet-mini-caption">напомнит, когда придёт время</div>`;
  $('#sound-status').innerHTML = `${icon(state.soundEnabled ? 'volume' : 'volumeOff', 15)}<span>${state.soundEnabled ? 'Звук включён' : 'Звук выключен'}</span>`;
  $('#nav-count').textContent = String(allReminderEntries().filter((entry) => entry.enabled).length);
}

function renderHeader() {
  const current = pet(state.petId);
  const now = new Date();
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now);
  $('#date-label').textContent = `${dayLongLabels[day]}, ${date}`;
  $('#greeting-name').textContent = current.name;
  $('#greeting-copy').textContent = current.greeting;
  $('#hero-art').innerHTML = petSprite(state.petId, { motion: 'idle' });
  document.documentElement.style.setProperty('--pet-accent', current.accent);
}

function reminderRow(entry, { showTest = false } = {}) {
  const iconName = entry.type === 'movement' ? 'movement' : entry.type === 'custom' ? 'spark' : 'water';
  return `<div class="reminder-row"><div class="reminder-row-icon ${entry.type}">${icon(iconName, 17)}</div><div class="reminder-row-copy"><div class="reminder-row-title">${escapeHtml(entry.title)}</div><div class="reminder-row-meta">${escapeHtml(entry.description)} · ${scheduleLabel(entry)}</div></div><div class="reminder-row-action">${showTest ? `<button class="test-link" data-test="${escapeHtml(entry.key)}">Показать</button>` : `<span class="reminder-row-time">${entry.enabled ? 'вкл.' : 'выкл.'}</span>`}<button class="toggle ${entry.enabled ? 'is-on' : ''}" aria-label="${entry.enabled ? 'Выключить' : 'Включить'} ${escapeHtml(entry.title)}" data-toggle="${escapeHtml(entry.key)}"></button></div></div>`;
}

function renderOverview() {
  const entries = allReminderEntries();
  const waterCount = todayHistory('water').length;
  const movementCount = todayHistory('movement').length;
  $('#water-count').textContent = String(waterCount);
  $('#water-unit').textContent = plural(waterCount, 'пауза', 'паузы', 'пауз');
  $('#movement-count').textContent = String(movementCount);
  $('#movement-unit').textContent = plural(movementCount, 'разминка', 'разминки', 'разминок');
  $('#water-progress').style.width = `${Math.min(100, waterCount / 6 * 100)}%`;
  $('#movement-progress').style.width = `${Math.min(100, movementCount / 3 * 100)}%`;
  $('#water-schedule').textContent = scheduleLabel(state.reminders.water);
  $('#movement-schedule').textContent = scheduleLabel(state.reminders.movement);
  $('#quiet-caption').textContent = `${state.quietHours.from} - ${state.quietHours.to}`;
  $('#quiet-status').textContent = state.quietHours.enabled ? 'Вкл' : 'Выкл';
  $('#overview-reminders').innerHTML = entries.slice(0, 4).map((entry) => reminderRow(entry, { showTest: true })).join('');

  const next = entries.filter((entry) => entry.enabled && entry.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0] || entries[0];
  const preview = reminderText({ type: next.type, petId: state.petId, exercise: state.reminders.movement.exercise, amount: state.reminders.movement.amount, title: next.title, message: next.description });
  $('#next-title').textContent = next.title;
  $('#next-test').dataset.test = next.key;
  $('#next-time').textContent = next.enabled ? formatNextTime(next.nextAt) : 'выключено';
  $('#next-copy').textContent = preview.message;
  $('#next-visual').innerHTML = petSprite(state.petId, { motion: 'review' });
}

function dayButtons(entry) {
  return `<div class="editor-days">${[1, 2, 3, 4, 5, 6, 7].map((day) => `<button class="day-chip ${(entry.days || []).includes(day) ? 'is-active' : ''}" type="button" data-day-key="${escapeHtml(entry.key)}" data-day="${day}" aria-label="${dayLongLabels[day]}">${dayLabels[day]}</button>`).join('')}</div>`;
}

function intervalSelect(entry) {
  const options = [30, 45, 60, 90, 120, 180, 240];
  return `<select class="select-control" data-interval-key="${escapeHtml(entry.key)}" aria-label="Периодичность">${options.map((value) => `<option value="${value}" ${Number(entry.everyMinutes) === value ? 'selected' : ''}>${formatInterval(value)}</option>`).join('')}</select>`;
}

function modeSwitch(entry) {
  const isTime = entry.frequency === 'time';
  return `<div class="mode-switch" role="group" aria-label="Как напоминать"><button type="button" class="${isTime ? '' : 'is-active'}" data-mode-key="${escapeHtml(entry.key)}" data-mode="interval">По интервалу</button><button type="button" class="${isTime ? 'is-active' : ''}" data-mode-key="${escapeHtml(entry.key)}" data-mode="time">В точное время</button></div>`;
}

function scheduleControl(entry) {
  return entry.frequency === 'time'
    ? `<input class="time-control" type="time" value="${entry.time || '09:00'}" data-time-key="${escapeHtml(entry.key)}" aria-label="Время напоминания" />`
    : intervalSelect(entry);
}

function editorRow(entry) {
  const isCustom = entry.type === 'custom';
  const iconName = entry.type === 'movement' ? 'movement' : entry.type === 'custom' ? 'spark' : 'water';
  const tag = entry.type === 'water' ? 'вода' : entry.type === 'movement' ? 'движение' : '';
  return `<div class="editor-row" data-editor-key="${escapeHtml(entry.key)}"><div class="editor-icon ${entry.type}">${icon(iconName, 18)}</div><div class="editor-copy"><div class="editor-title"><span>${escapeHtml(entry.title)}</span>${tag ? `<span class="muted-note">${tag}</span>` : ''}</div><p class="editor-description">${escapeHtml(entry.description)}</p>${modeSwitch(entry)}<div class="editor-controls">${scheduleControl(entry)}<span class="editor-description" style="margin:0">${entry.frequency === 'time' ? 'по выбранным дням' : 'в течение дня'}</span></div>${dayButtons(entry)}</div><button class="toggle ${entry.enabled ? 'is-on' : ''}" data-toggle="${escapeHtml(entry.key)}" aria-label="${entry.enabled ? 'Выключить' : 'Включить'} ${escapeHtml(entry.title)}"></button>${isCustom ? `<button class="editor-delete" data-delete="${escapeHtml(entry.key)}" aria-label="Удалить напоминание">${icon('trash', 14)}</button>` : ''}</div>`;
}

function renderRemindersEditor() {
  const entries = allReminderEntries();
  $('#reminders-editor').innerHTML = entries.map(editorRow).join('');
  $('#habits-count').textContent = pluralize(entries.length, 'напоминание', 'напоминания', 'напоминаний');
}

function renderHistory() {
  const history = [...state.history].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const todayCount = state.history.filter((item) => isToday(item.completedAt)).length;
  $('#history-today-count').textContent = String(todayCount);
  $('#history-today-unit').textContent = `${plural(todayCount, 'пауза', 'паузы', 'пауз')} сегодня`;
  $('#history-total').textContent = `всего ${pluralize(history.length, 'отметка', 'отметки', 'отметок')}`;
  $('#history-pet-signature').textContent = `${pet(state.petId).name} рядом с тобой`;
  $('#history-list').innerHTML = history.length
    ? history.slice(0, 15).map((item) => `<div class="history-item"><div class="history-item-icon">${icon(item.key === 'movement' ? 'movement' : item.key === 'water' ? 'water' : 'spark', 17)}</div><div class="history-item-copy"><div class="history-item-title">${escapeHtml(historyLabel(item))}</div><div class="history-item-time">${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt))}</div></div><span class="history-item-check">${icon('checkCircle', 17)}</span></div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">✦</div><div>Здесь появятся отмеченные паузы.</div></div>';
}

function petChoice(petId, selected, mode = 'settings') {
  const current = PETS[petId];
  return `<button class="pet-choice ${selected ? 'is-selected' : ''}" style="--pet-soft:${current.soft}" data-${mode === 'onboarding' ? 'onboarding-pet' : 'settings-pet'}="${petId}"><span class="pet-choice-check">${icon('check', 11)}</span><div class="pet-choice-art">${petSprite(petId, { motion: selected ? 'waving' : 'idle' })}</div><div class="pet-choice-copy"><div class="pet-choice-name">${current.name}</div><div class="pet-choice-species">${current.short}</div></div></button>`;
}

function renderPetChoices() {
  $('#settings-pet-choice').innerHTML = PET_ORDER.map((petId) => petChoice(petId, petId === state.petId, 'settings')).join('');
  $('#onboarding-pet-grid').innerHTML = PET_ORDER.map((petId) => petChoice(petId, petId === onboardingPet, 'onboarding')).join('');
  const continueButton = $('#onboarding-continue');
  continueButton.disabled = !onboardingPet;
  continueButton.querySelector('span').textContent = onboardingPet ? `Выбрать ${PETS[onboardingPet].name}` : 'Выбрать питомца';
}

function renderPreferences() {
  const snoozeOptions = [5, 10, 15, 30];
  $('#preferences-editor').innerHTML = `<div class="preference-list">
    <div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon(state.soundEnabled ? 'volume' : 'volumeOff', 15)}</div><div><div class="preference-title">Звук питомца</div><div class="preference-description">${state.soundEnabled ? 'Питомец подаёт голос, когда появляется.' : 'Напоминания приходят без звука.'}</div></div></div><button class="toggle ${state.soundEnabled ? 'is-on' : ''}" data-sound-toggle aria-label="Переключить звук"></button></div>
    <div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('volume', 15)}</div><div><div class="preference-title">Громкость</div><div class="preference-description">Можно сделать тише или громче.</div></div></div><div class="range-wrap"><input type="range" min="0" max="100" value="${Math.round(state.volume * 100)}" data-volume aria-label="Громкость" /><span class="range-value">${Math.round(state.volume * 100)}%</span></div></div>
    <div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('snooze', 15)}</div><div><div class="preference-title">Кнопка «Отложить»</div><div class="preference-description">На сколько сдвигать напоминание.</div></div></div><select class="select-control" data-snooze aria-label="Отложить на">${snoozeOptions.map((value) => `<option value="${value}" ${Number(state.snoozeMinutes) === value ? 'selected' : ''}>${pluralize(value, 'минуту', 'минуты', 'минут')}</option>`).join('')}</select></div>
    <div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('spark', 15)}</div><div><div class="preference-title">Запускать при входе в систему</div><div class="preference-description">Работает только в установленном приложении.</div></div></div><button class="toggle ${state.autostart ? 'is-on' : ''}" data-autostart-toggle aria-label="Переключить автозапуск"></button></div>
    <div class="preference-divider"><p class="eyebrow">ТИХИЕ ЧАСЫ</p>
      <div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('clock', 15)}</div><div><div class="preference-title">Не тревожить</div><div class="preference-description">В это время питомец не появится.</div></div></div><button class="toggle ${state.quietHours.enabled ? 'is-on' : ''}" data-quiet-toggle aria-label="Переключить тихие часы"></button></div>
      <div class="quiet-form"><span class="preference-hint">с</span><input class="time-control" type="time" value="${state.quietHours.from}" data-quiet-from aria-label="Начало тихих часов" /><span class="preference-hint">до</span><input class="time-control" type="time" value="${state.quietHours.to}" data-quiet-to aria-label="Конец тихих часов" /></div>
    </div>
  </div>`;
}

function renderOnboarding() {
  $('#onboarding').classList.toggle('is-hidden', state.onboardingComplete);
  renderPetChoices();
}

function renderApp() {
  if (!state) return;
  renderSidebar();
  renderHeader();
  renderOverview();
  renderRemindersEditor();
  renderHistory();
  renderExercises(state);
  renderPreferences();
  renderOnboarding();
  setView(currentView);
  renderIcons();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function choosePet(petId, onboarding = false) {
  if (onboarding) {
    onboardingPet = petId;
    renderPetChoices();
    return;
  }
  state.petId = petId;
  saveAndRender(`${PETS[petId].name} теперь рядом.`);
}

function toggleReminder(key) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.enabled = !entry.enabled;
  if (entry.enabled && entry.frequency !== 'time') entry.nextAt = Date.now() + (entry.everyMinutes || 60) * 60 * 1000;
  saveAndRender(entry.enabled ? `«${entry.title || 'Напоминание'}» включено.` : `«${entry.title || 'Напоминание'}» выключено.`);
}

function changeInterval(key, value) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.everyMinutes = Number(value);
  entry.nextAt = Date.now() + entry.everyMinutes * 60 * 1000;
  saveAndRender('Интервал сохранён.');
}

function changeTime(key, value) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.time = value;
  entry.nextAt = null;
  saveAndRender('Время сохранено.');
}

function changeMode(key, mode) {
  const entry = getEntry(key);
  if (!entry || entry.frequency === mode) return;
  entry.frequency = mode;
  entry.nextAt = mode === 'time' ? null : Date.now() + (entry.everyMinutes || 60) * 60 * 1000;
  saveAndRender(mode === 'time' ? 'Теперь напоминание приходит в точное время.' : 'Теперь напоминание приходит по интервалу.');
}

function toggleDay(key, day) {
  const entry = getEntry(key);
  if (!entry) return;
  const days = entry.days || [];
  entry.days = days.includes(day) ? days.filter((value) => value !== day) : [...days, day].sort();
  if (!entry.days.length) entry.days = [activeDay()];
  saveAndRender('Дни сохранены.');
}

function handleFormSubmit(form) {
  const data = new FormData(form);
  const daysValue = data.get('days');
  const days = daysValue === 'all' ? [1, 2, 3, 4, 5, 6, 7] : daysValue === 'weekend' ? [6, 7] : [1, 2, 3, 4, 5];
  const scheduleMode = String(data.get('scheduleMode') || 'interval');
  const everyMinutes = Number(data.get('everyMinutes') || 60);
  const time = String(data.get('clockTime') || '15:00');
  const title = String(data.get('title') || '').trim();
  if (!title) return;
  state.customReminders.push({
    id: `custom-${Date.now()}`,
    title,
    message: String(data.get('message') || '').trim() || 'Отойди от экрана на минуту.',
    enabled: true,
    everyMinutes,
    days,
    frequency: scheduleMode === 'time' ? 'time' : 'interval',
    time,
    nextAt: scheduleMode === 'time' ? null : Date.now() + everyMinutes * 60 * 1000
  });
  form.reset();
  saveAndRender('Напоминание добавлено.');
}

function deleteReminder(key) {
  const entry = getEntry(key);
  if (!entry) return;
  state.customReminders = state.customReminders.filter((reminder) => reminder.id !== key);
  saveAndRender(`«${entry.title}» удалено.`);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) return setView(viewButton.dataset.view);

    const windowButton = event.target.closest('[data-window]');
    if (windowButton) return api.windowAction(windowButton.dataset.window);

    if (event.target.closest('[data-developer-site]')) return api.openDeveloperSite();

    const testButton = event.target.closest('[data-test]');
    if (testButton) {
      return api.testReminder(testButton.dataset.test).then(shown => showToast(shown ? 'Показываю напоминание.' : 'Сначала включите хотя бы одно упражнение.'));
    }

    const modeButton = event.target.closest('[data-mode-key]');
    if (modeButton) return changeMode(modeButton.dataset.modeKey, modeButton.dataset.mode);

    const toggleButton = event.target.closest('[data-toggle]');
    if (toggleButton) return toggleReminder(toggleButton.dataset.toggle);

    const onboardingChoice = event.target.closest('[data-onboarding-pet]');
    if (onboardingChoice) return choosePet(onboardingChoice.dataset.onboardingPet, true);

    const settingsChoice = event.target.closest('[data-settings-pet]');
    if (settingsChoice) return choosePet(settingsChoice.dataset.settingsPet);

    const dayButton = event.target.closest('[data-day-key]');
    if (dayButton) return toggleDay(dayButton.dataset.dayKey, Number(dayButton.dataset.day));

    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) return deleteReminder(deleteButton.dataset.delete);

    if (event.target.closest('[data-sound-toggle]')) {
      state.soundEnabled = !state.soundEnabled;
      return saveAndRender(state.soundEnabled ? 'Звук включён.' : 'Звук выключен.');
    }

    if (event.target.closest('[data-autostart-toggle]')) {
      state.autostart = !state.autostart;
      return saveAndRender(state.autostart ? 'Приложение будет запускаться при входе.' : 'Автозапуск выключен.');
    }

    if (event.target.closest('[data-quiet-toggle]')) {
      state.quietHours.enabled = !state.quietHours.enabled;
      return saveAndRender(state.quietHours.enabled ? 'Тихие часы включены.' : 'Тихие часы выключены.');
    }

    if (event.target.closest('#onboarding-continue') && onboardingPet) {
      state.petId = onboardingPet;
      state.onboardingComplete = true;
      return saveAndRender(`${PETS[onboardingPet].name} теперь рядом.`);
    }
    return undefined;
  });

  document.addEventListener('change', (event) => {
    const interval = event.target.closest('[data-interval-key]');
    if (interval) return changeInterval(interval.dataset.intervalKey, interval.value);

    const time = event.target.closest('[data-time-key]');
    if (time) return changeTime(time.dataset.timeKey, time.value);

    const volume = event.target.closest('[data-volume]');
    if (volume) {
      state.volume = Number(volume.value) / 100;
      return saveAndRender('Громкость сохранена.');
    }

    const snooze = event.target.closest('[data-snooze]');
    if (snooze) {
      state.snoozeMinutes = Number(snooze.value);
      return saveAndRender('Сохранено.');
    }

    const from = event.target.closest('[data-quiet-from]');
    if (from) {
      state.quietHours.from = from.value;
      return saveAndRender('Тихие часы сохранены.');
    }

    const to = event.target.closest('[data-quiet-to]');
    if (to) {
      state.quietHours.to = to.value;
      return saveAndRender('Тихие часы сохранены.');
    }
    return undefined;
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id === 'custom-form') {
      event.preventDefault();
      handleFormSubmit(event.target);
    }
  });
}

async function init() {
  bindEvents();
  startPetAnimations();
  state = await api.getState();
  bindExercises({getState: () => state, save: saveAndRender, acceptState: next => {state=next; renderApp();}, toast: showToast, api});
  let displayedDay = new Date().toDateString();
  setInterval(() => { if (displayedDay !== new Date().toDateString()) { displayedDay = new Date().toDateString(); renderApp(); } }, 30000);
  onboardingPet = state.onboardingComplete ? state.petId : null;
  api.onStateUpdated((nextState) => { state = nextState; renderApp(); });
  api.onNavigate((view) => setView(view));
  api.onReminderShown((payload) => showToast(`Напоминание от ${pet(payload.petId).name}.`));
  renderApp();
}

init();
