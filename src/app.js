import { PETS, PET_ORDER, REMINDER_CATALOG, petSprite, startPetAnimations, icon, formatInterval, formatDateTime } from './petRenderer.js';

const api = window.desktopApi;
let state;
let currentView = 'overview';
let onboardingPet = null;
let toastTimer;

const dayLabels = { 1: 'П', 2: 'В', 3: 'С', 4: 'Ч', 5: 'П', 6: 'С', 7: 'В' };
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

function todayHistory(key) {
  const today = new Date().toDateString();
  return state.history.filter((item) => item.key === key && new Date(item.completedAt).toDateString() === today);
}

function allReminderEntries() {
  const entries = [
    { id: 'water', key: 'water', type: 'water', title: 'Вода', description: 'Несколько глотков, чтобы вернуть ясность.', ...state.reminders.water },
    { id: 'movement', key: 'movement', type: 'movement', title: 'Разминка', description: `${state.reminders.movement.exercise || 'Разминка'} · ${state.reminders.movement.amount || 'пара повторений'}`, ...state.reminders.movement }
  ];
  for (const reminder of state.customReminders) {
    entries.push({ id: reminder.id, key: reminder.id, type: 'custom', title: reminder.title, description: reminder.message || 'Личная пауза', ...reminder });
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

function getEntryType(key) {
  if (key === 'water' || key === 'movement') return key;
  return 'custom';
}

function scheduleLabel(entry) {
  return entry.frequency === 'time' ? `в ${entry.time || '09:00'}` : formatInterval(entry.everyMinutes || 60);
}

function setView(view) {
  currentView = view;
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.viewPanel === view));
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
}

function renderIcons() {
  $$('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon, element.dataset.icon === 'spark' ? 15 : 17); });
  $$('[data-nav-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.navIcon, 17); });
}

function renderSidebar() {
  const pet = PETS[state.petId] || PETS.winnie;
  $('#sidebar-pet-card').innerHTML = `<div class="pet-mini-row"><div class="pet-mini-art">${petSprite(state.petId, { motion: 'idle' })}</div><div><div class="pet-mini-name">${pet.name} рядом</div><div class="pet-mini-type">${pet.species}</div></div></div><div class="pet-mini-caption">готов напомнить о паузе</div>`;
  $('#sound-status').innerHTML = `${icon(state.soundEnabled ? 'volume' : 'volumeOff', 15)}<span>${state.soundEnabled ? 'Звук включён' : 'Звук выключен'}</span>`;
  $('#nav-count').textContent = String(allReminderEntries().filter((entry) => entry.enabled).length);
}

function renderHeader() {
  const pet = PETS[state.petId] || PETS.winnie;
  const now = new Date();
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now);
  $('#date-label').textContent = `${dayLongLabels[day].toUpperCase()}, ${date.toUpperCase()}`;
  $('#greeting-name').textContent = pet.name;
  $('#greeting-copy').textContent = pet.greeting;
  $('#hero-art').innerHTML = petSprite(state.petId, { motion: 'idle' });
  document.documentElement.style.setProperty('--pet-accent', pet.accent);
}

function formatNextTime(nextAt) {
  if (!nextAt) return 'по твоему ритму';
  const diff = Math.max(0, nextAt - Date.now());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'уже скоро';
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  return `через ${hours} ${hours === 1 ? 'час' : 'ч'}`;
}

function reminderRow(entry, { showTest = false } = {}) {
  const iconName = entry.type === 'movement' ? 'movement' : entry.type === 'custom' ? 'spark' : 'water';
  const time = scheduleLabel(entry);
  return `<div class="reminder-row"><div class="reminder-row-icon ${entry.type}">${icon(iconName, 17)}</div><div class="reminder-row-copy"><div class="reminder-row-title">${escapeHtml(entry.title)}</div><div class="reminder-row-meta">${escapeHtml(entry.description)} · ${time}</div></div><div class="reminder-row-action">${showTest ? `<button class="test-link" data-test="${entry.key === 'movement' ? 'movement' : 'water'}">Проверить</button>` : `<span class="reminder-row-time">${entry.enabled ? 'включено' : 'выкл.'}</span>`}<button class="toggle ${entry.enabled ? 'is-on' : ''}" aria-label="${entry.enabled ? 'Выключить' : 'Включить'} ${escapeHtml(entry.title)}" data-toggle="${entry.key}"></button></div></div>`;
}

function renderOverview() {
  const waterCount = todayHistory('water').length;
  const movementCount = todayHistory('movement').length;
  $('#water-count').textContent = String(waterCount);
  $('#movement-count').textContent = String(movementCount);
  $('#water-progress').style.width = `${Math.min(100, waterCount / 6 * 100)}%`;
  $('#movement-progress').style.width = `${Math.min(100, movementCount / 3 * 100)}%`;
  $('#water-schedule').textContent = formatInterval(state.reminders.water.everyMinutes);
  $('#movement-schedule').textContent = formatInterval(state.reminders.movement.everyMinutes);
  $('#quiet-caption').textContent = `${state.quietHours.from} — ${state.quietHours.to}`;
  $('#quiet-status').textContent = state.quietHours.enabled ? 'Вкл' : 'Выкл';
  $('#overview-reminders').innerHTML = allReminderEntries().slice(0, 4).map((entry) => reminderRow(entry, { showTest: true })).join('');

  const next = allReminderEntries().filter((entry) => entry.enabled && entry.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0] || allReminderEntries()[0];
  const nextLabel = next.type === 'movement' ? 'Разминка' : next.type === 'custom' ? next.title : 'Вода';
  $('#next-title').textContent = nextLabel;
  $('#next-time').textContent = formatNextTime(next.nextAt);
  $('#next-copy').textContent = next.type === 'movement' ? `${state.reminders.movement.exercise} — ${state.reminders.movement.amount}. ${PETS[state.petId].name} поддержит.` : next.type === 'custom' ? next.description : 'Пара глотков, и концентрация вернётся мягче.';
  $('#next-visual').innerHTML = petSprite(state.petId, { motion: 'review' });
}

function dayButtons(entry) {
  return `<div class="editor-days">${[1, 2, 3, 4, 5, 6, 7].map((day) => `<button class="day-chip ${(entry.days || []).includes(day) ? 'is-active' : ''}" type="button" data-day-key="${entry.key}" data-day="${day}" aria-label="${dayLongLabels[day]}">${dayLabels[day]}</button>`).join('')}</div>`;
}

function intervalSelect(entry) {
  const options = [30, 45, 60, 90, 120, 180, 240];
  return `<select class="select-control" data-interval-key="${entry.key}" aria-label="Периодичность">${options.map((value) => `<option value="${value}" ${Number(entry.everyMinutes) === value ? 'selected' : ''}>${formatInterval(value)}</option>`).join('')}</select>`;
}

function scheduleControl(entry) {
  return entry.frequency === 'time'
    ? `<input class="time-control" type="time" value="${entry.time || '09:00'}" data-time-key="${entry.key}" aria-label="Время напоминания" />`
    : intervalSelect(entry);
}

function editorRow(entry) {
  const isCustom = entry.type === 'custom';
  const iconName = entry.type === 'movement' ? 'movement' : entry.type === 'custom' ? 'spark' : 'water';
  return `<div class="editor-row" data-editor-key="${entry.key}"><div class="editor-icon ${entry.type}">${icon(iconName, 18)}</div><div class="editor-copy"><div class="editor-title"><span>${escapeHtml(entry.title)}</span>${isCustom ? '' : `<span class="muted-note">${entry.type === 'water' ? 'гидратация' : 'энергия'}</span>`}</div><p class="editor-description">${escapeHtml(entry.description)}</p><div class="editor-controls">${scheduleControl(entry)}<span class="editor-description" style="margin:0">${entry.frequency === 'time' ? 'по выбранным дням' : 'в течение дня'}</span></div>${dayButtons(entry)}</div><button class="toggle ${entry.enabled ? 'is-on' : ''}" data-toggle="${entry.key}" aria-label="${entry.enabled ? 'Выключить' : 'Включить'} ${escapeHtml(entry.title)}"></button>${isCustom ? `<button class="editor-delete" data-delete="${entry.key}" aria-label="Удалить напоминание">${icon('trash', 14)}</button>` : ''}</div>`;
}

function renderRemindersEditor() {
  $('#reminders-editor').innerHTML = allReminderEntries().map(editorRow).join('');
}

function renderHistory() {
  const history = [...state.history].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const todayCount = todayHistory('water').length + todayHistory('movement').length + state.history.filter((item) => item.key.startsWith('custom-') && new Date(item.completedAt).toDateString() === new Date().toDateString()).length;
  $('#history-today-count').textContent = String(todayCount);
  $('#history-total').textContent = `${history.length} всего`;
  $('#history-pet-signature').textContent = `${PETS[state.petId].name} · рядом с тобой`;
  $('#history-list').innerHTML = history.length ? history.slice(0, 15).map((item) => `<div class="history-item"><div class="history-item-icon">${icon(item.key === 'movement' ? 'movement' : item.key === 'water' ? 'water' : 'spark', 17)}</div><div class="history-item-copy"><div class="history-item-title">${escapeHtml(item.action || item.title || 'Пауза отмечена')}</div><div class="history-item-time">${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt))}</div></div><span class="history-item-check">${icon('checkCircle', 17)}</span></div>`).join('') : `<div class="empty-state"><div class="empty-icon">✦</div><div>Здесь появятся твои первые<br />подтверждённые паузы.</div></div>`;
}

function petChoice(petId, selected, mode = 'settings') {
  const pet = PETS[petId];
  return `<button class="pet-choice ${selected ? 'is-selected' : ''}" style="--pet-soft:${pet.soft}" data-${mode === 'onboarding' ? 'onboarding-pet' : 'settings-pet'}="${petId}"><span class="pet-choice-check">${icon('check', 11)}</span><div class="pet-choice-art">${petSprite(petId, { motion: selected ? 'waving' : 'idle' })}</div><div class="pet-choice-copy"><div class="pet-choice-name">${pet.name}</div><div class="pet-choice-species">${pet.short}</div></div></button>`;
}

function renderPetChoices() {
  $('#settings-pet-choice').innerHTML = PET_ORDER.map((petId) => petChoice(petId, petId === state.petId, 'settings')).join('');
  $('#onboarding-pet-grid').innerHTML = PET_ORDER.map((petId) => petChoice(petId, petId === onboardingPet, 'onboarding')).join('');
  const continueButton = $('#onboarding-continue');
  continueButton.disabled = !onboardingPet;
  continueButton.querySelector('span').textContent = onboardingPet ? `Выбрать ${PETS[onboardingPet].name}` : 'Выбрать питомца';
}

function renderPreferences() {
  $('#preferences-editor').innerHTML = `<div class="preference-list"><div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon(state.soundEnabled ? 'volume' : 'volumeOff', 15)}</div><div><div class="preference-title">Звуки питомца</div><div class="preference-description">${state.soundEnabled ? 'Будет гавкать, мурлыкать и щёлкать орешки.' : 'Напоминания будут без звука.'}</div></div></div><button class="toggle ${state.soundEnabled ? 'is-on' : ''}" data-sound-toggle aria-label="Переключить звуки"></button></div><div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('volume', 15)}</div><div><div class="preference-title">Громкость</div><div class="preference-description">Можно сделать тише или громче.</div></div></div><div class="range-wrap"><input type="range" min="0" max="100" value="${Math.round(state.volume * 100)}" data-volume /><span class="range-value">${Math.round(state.volume * 100)}%</span></div></div><div class="preference-divider"><p class="eyebrow">ТИХИЕ ЧАСЫ</p><div class="preference-row"><div class="preference-copy"><div class="preference-icon">${icon('clock', 15)}</div><div><div class="preference-title">Не тревожить</div><div class="preference-description">Питомцы не будут появляться в этот период.</div></div></div><button class="toggle ${state.quietHours.enabled ? 'is-on' : ''}" data-quiet-toggle aria-label="Переключить тихие часы"></button></div><div class="quiet-form"><span class="preference-hint">с</span><input class="time-control" type="time" value="${state.quietHours.from}" data-quiet-from /><span class="preference-hint">до</span><input class="time-control" type="time" value="${state.quietHours.to}" data-quiet-to /></div></div></div>`;
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
  renderPreferences();
  renderPetChoices();
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
  saveAndRender(entry.enabled ? `${entry.title || 'Напоминание'} включено.` : `${entry.title || 'Напоминание'} выключено.`);
}

function changeInterval(key, value) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.everyMinutes = Number(value);
  entry.nextAt = Date.now() + entry.everyMinutes * 60 * 1000;
  saveAndRender('Ритм обновлён.');
}

function changeTime(key, value) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.time = value;
  entry.frequency = 'time';
  entry.nextAt = Date.now() + 60 * 1000;
  saveAndRender('Время напоминания обновлено.');
}

function toggleDay(key, day) {
  const entry = getEntry(key);
  if (!entry) return;
  entry.days = entry.days || [];
  entry.days = entry.days.includes(day) ? entry.days.filter((value) => value !== day) : [...entry.days, day].sort();
  if (!entry.days.length) entry.days = [activeDay()];
  saveAndRender('Дни напоминания обновлены.');
}

function handleFormSubmit(form) {
  const data = new FormData(form);
  const daysValue = data.get('days');
  const days = daysValue === 'all' ? [1, 2, 3, 4, 5, 6, 7] : daysValue === 'weekend' ? [6, 7] : [1, 2, 3, 4, 5];
  const scheduleMode = String(data.get('scheduleMode') || 'interval');
  const everyMinutes = Number(data.get('everyMinutes') || 60);
  const time = String(data.get('clockTime') || '15:00');
  state.customReminders.push({
    id: `custom-${Date.now()}`,
    title: String(data.get('title') || '').trim(),
    message: String(data.get('message') || '').trim() || 'Небольшая пауза тоже считается заботой о себе.',
    enabled: true,
    everyMinutes,
    days,
    frequency: scheduleMode === 'time' ? 'time' : 'interval',
    time,
    nextAt: scheduleMode === 'time' ? Date.now() + 60 * 1000 : Date.now() + everyMinutes * 60 * 1000
  });
  form.reset();
  saveAndRender('Новое напоминание добавлено.');
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
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }
    const windowButton = event.target.closest('[data-window]');
    if (windowButton) {
      api.windowAction(windowButton.dataset.window);
      return;
    }
    if (event.target.closest('[data-developer-site]')) {
      api.openDeveloperSite();
      return;
    }
    const testButton = event.target.closest('[data-test]');
    if (testButton) {
      api.testReminder(testButton.dataset.test);
      showToast('Питомец уже идёт к тебе.');
      return;
    }
    const toggleButton = event.target.closest('[data-toggle]');
    if (toggleButton) {
      toggleReminder(toggleButton.dataset.toggle);
      return;
    }
    const onboardingChoice = event.target.closest('[data-onboarding-pet]');
    if (onboardingChoice) {
      choosePet(onboardingChoice.dataset.onboardingPet, true);
      return;
    }
    const settingsChoice = event.target.closest('[data-settings-pet]');
    if (settingsChoice) {
      choosePet(settingsChoice.dataset.settingsPet);
      return;
    }
    const dayButton = event.target.closest('[data-day-key]');
    if (dayButton) {
      toggleDay(dayButton.dataset.dayKey, Number(dayButton.dataset.day));
      return;
    }
    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) {
      deleteReminder(deleteButton.dataset.delete);
    }
  });

  document.addEventListener('change', (event) => {
    const interval = event.target.closest('[data-interval-key]');
    if (interval) changeInterval(interval.dataset.intervalKey, interval.value);
    const time = event.target.closest('[data-time-key]');
    if (time) changeTime(time.dataset.timeKey, time.value);
    const volume = event.target.closest('[data-volume]');
    if (volume) {
      state.volume = Number(volume.value) / 100;
      saveAndRender('Громкость сохранена.');
    }
    const from = event.target.closest('[data-quiet-from]');
    if (from) { state.quietHours.from = from.value; saveAndRender('Тихие часы обновлены.'); }
    const to = event.target.closest('[data-quiet-to]');
    if (to) { state.quietHours.to = to.value; saveAndRender('Тихие часы обновлены.'); }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-sound-toggle]')) {
      state.soundEnabled = !state.soundEnabled;
      saveAndRender(state.soundEnabled ? 'Звуки питомца включены.' : 'Звуки питомца выключены.');
    }
    if (event.target.closest('[data-quiet-toggle]')) {
      state.quietHours.enabled = !state.quietHours.enabled;
      saveAndRender(state.quietHours.enabled ? 'Тихие часы включены.' : 'Тихие часы выключены.');
    }
    if (event.target.closest('#onboarding-continue') && onboardingPet) {
      state.petId = onboardingPet;
      state.onboardingComplete = true;
      saveAndRender(`${PETS[onboardingPet].name} теперь рядом.`);
    }
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
  onboardingPet = state.onboardingComplete ? state.petId : null;
  api.onStateUpdated((nextState) => { state = nextState; renderApp(); });
  api.onNavigate((view) => setView(view));
  api.onReminderShown((payload) => showToast(`${payload.petName} появился с напоминанием.`));
  renderApp();
}

init();
