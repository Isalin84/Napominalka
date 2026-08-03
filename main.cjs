const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let popupWindow;
let state;
let scheduler;
let popupMoveSaveTimer;

const APP_NAME = 'Напоминалка';
const DEVELOPER_URL = 'https://bestpracticeai.ru/';
app.setName(APP_NAME);

const PETS = {
  winnie: { name: 'Винни', species: 'той-пудель', bark: 'Гав!' },
  max: { name: 'Макс', species: 'котёнок', bark: 'Мр-р' },
  sovushka: { name: 'Совушка', species: 'сова', bark: 'Ух-уух' },
  belochka: { name: 'Белочка', species: 'белочка', bark: 'Щёлк-щёлк' }
};

function createDefaultState() {
  const now = Date.now();
  return {
    onboardingComplete: false,
    petId: 'winnie',
    soundEnabled: true,
    volume: 0.65,
    popupPosition: null,
    quietHours: { enabled: true, from: '22:00', to: '07:00' },
    reminders: {
      water: {
        enabled: true,
        everyMinutes: 60,
        days: [1, 2, 3, 4, 5],
        nextAt: now + 60 * 60 * 1000
      },
      movement: {
        enabled: true,
        everyMinutes: 120,
        days: [1, 2, 3, 4, 5],
        exercise: 'Приседания',
        amount: '12 раз',
        nextAt: now + 120 * 60 * 1000
      }
    },
    customReminders: [],
    history: []
  };
}

function stateFile() {
  return path.join(app.getPath('userData'), 'napominalka.json');
}

function legacyStateFile() {
  return path.join(app.getPath('userData'), 'paws-and-pauses.json');
}

function stateCandidates() {
  const appData = app.getPath('appData');
  return [
    stateFile(),
    legacyStateFile(),
    path.join(appData, 'Пауза рядом', 'paws-and-pauses.json'),
    path.join(appData, 'paws-and-pauses', 'paws-and-pauses.json'),
    path.join(appData, 'Electron', 'paws-and-pauses.json')
  ];
}

function mergeState(saved) {
  const base = createDefaultState();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    quietHours: { ...base.quietHours, ...(saved.quietHours || {}) },
    reminders: {
      ...base.reminders,
      ...(saved.reminders || {}),
      water: { ...base.reminders.water, ...((saved.reminders || {}).water || {}) },
      movement: { ...base.reminders.movement, ...((saved.reminders || {}).movement || {}) }
    },
    customReminders: Array.isArray(saved.customReminders) ? saved.customReminders : [],
    history: Array.isArray(saved.history) ? saved.history : []
  };
}

function loadState() {
  try {
    const file = stateCandidates().find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error('No saved state');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = mergeState(saved);
  } catch {
    state = createDefaultState();
  }
  ensureNextAt();
}

function persistState() {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function ensureNextAt() {
  const now = Date.now();
  for (const reminder of Object.values(state.reminders)) {
    if (!reminder.nextAt || reminder.nextAt < now - 24 * 60 * 60 * 1000) {
      reminder.nextAt = now + reminder.everyMinutes * 60 * 1000;
    }
  }
  for (const reminder of state.customReminders) {
    if (reminder.frequency === 'time' && (!reminder.nextAt || reminder.nextAt <= now + 60 * 1000)) {
      reminder.nextAt = nextTimeOccurrence(reminder.time, reminder.days, now);
    } else if (!reminder.nextAt || reminder.nextAt < now - 24 * 60 * 60 * 1000) {
      reminder.nextAt = reminder.frequency === 'time'
        ? nextTimeOccurrence(reminder.time, reminder.days, now)
        : now + reminder.everyMinutes * 60 * 1000;
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f6f1eb',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://bestpracticeai.ru/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function positionPopup() {
  if (!popupWindow) return;
  const [width, height] = popupWindow.getSize();
  const saved = state.popupPosition;
  const display = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? screen.getDisplayNearestPoint({ x: saved.x + Math.round(width / 2), y: saved.y + Math.round(height / 2) })
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const fallbackX = Math.round(area.x + area.width - width - 24);
  const fallbackY = Math.round(area.y + area.height - height - 24);
  const x = Math.min(area.x + area.width - width, Math.max(area.x, saved?.x ?? fallbackX));
  const y = Math.min(area.y + area.height - height, Math.max(area.y, saved?.y ?? fallbackY));
  popupWindow.setPosition(Math.round(x), Math.round(y), false);
}

function rememberPopupPosition() {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  clearTimeout(popupMoveSaveTimer);
  popupMoveSaveTimer = setTimeout(() => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    const [x, y] = popupWindow.getPosition();
    state.popupPosition = { x, y };
    persistState();
  }, 220);
}

function createPopupWindow(payload) {
  if (!popupWindow) {
    popupWindow = new BrowserWindow({
      width: 430,
      height: 224,
      minWidth: 430,
      minHeight: 224,
      maxWidth: 430,
      maxHeight: 224,
      transparent: true,
      frame: false,
      resizable: false,
      movable: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    popupWindow.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') {
      popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    popupWindow.loadFile(path.join(__dirname, 'src', 'popup.html'));
    popupWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://bestpracticeai.ru/')) shell.openExternal(url);
      return { action: 'deny' };
    });
    popupWindow.on('move', rememberPopupPosition);
    popupWindow.on('closed', () => {
      clearTimeout(popupMoveSaveTimer);
      popupWindow = null;
    });
  }

  const sendPayload = () => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    popupWindow.webContents.send('popup:reminder', payload);
    positionPopup();
    popupWindow.showInactive();
    popupWindow.focus();
  };

  if (popupWindow.webContents.isLoading()) {
    popupWindow.webContents.once('did-finish-load', sendPayload);
  } else {
    sendPayload();
  }
}

function isQuietTime(date = new Date()) {
  if (!state.quietHours.enabled) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  const [fromHour, fromMinute] = state.quietHours.from.split(':').map(Number);
  const [toHour, toMinute] = state.quietHours.to.split(':').map(Number);
  const from = fromHour * 60 + fromMinute;
  const to = toHour * 60 + toMinute;
  return from > to ? current >= from || current < to : current >= from && current < to;
}

function activeToday(reminder) {
  const day = new Date().getDay();
  const normalizedDay = day === 0 ? 7 : day;
  return (reminder.days || []).includes(normalizedDay);
}

function nextTimeOccurrence(time, days = [1, 2, 3, 4, 5], from = Date.now()) {
  const [hour, minute] = String(time || '09:00').split(':').map(Number);
  const start = new Date(from);
  start.setSeconds(0, 0);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    const day = candidate.getDay() === 0 ? 7 : candidate.getDay();
    if ((days || []).includes(day) && candidate.getTime() >= from) return candidate.getTime();
  }
  return from + 24 * 60 * 60 * 1000;
}

function buildPayload(key, override = {}) {
  const pet = PETS[state.petId] || PETS.winnie;
  const movement = state.reminders.movement;
  const base = key === 'movement'
    ? {
        title: 'Разомнёмся?',
        eyebrow: 'Маленькая пауза',
        message: `${movement.exercise || 'Небольшая разминка'} — ${movement.amount || 'пара повторений'}. ${pet.name} уже готов поддержать.`,
        action: 'Разминка выполнена',
        type: 'movement'
      }
    : key === 'water'
      ? {
          title: 'Пора попить воды',
          eyebrow: 'Тело скажет спасибо',
          message: 'Несколько глотков сейчас — и концентрация вернётся мягче.',
          action: 'Выпил воду',
          type: 'water'
        }
      : {
          title: override.title || 'Время для себя',
          eyebrow: 'Личная пауза',
          message: override.message || 'Небольшой перерыв тоже считается заботой о себе.',
          action: 'Готово',
          type: 'custom'
        };

  return {
    id: `${key}-${Date.now()}`,
    key,
    petId: state.petId,
    petName: pet.name,
    soundHint: pet.bark,
    soundEnabled: state.soundEnabled,
    volume: state.volume,
    createdAt: new Date().toISOString(),
    ...base,
    ...override
  };
}

function showReminder(key, override = {}) {
  const payload = buildPayload(key, override);
  createPopupWindow(payload);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:reminder-shown', payload);
}

function recordCompletion(payload) {
  state.history.push({
    id: payload.id,
    key: payload.key,
    title: payload.title,
    action: payload.action,
    petId: state.petId,
    completedAt: new Date().toISOString()
  });
  state.history = state.history.slice(-50);

  const reminder = state.reminders[payload.key] || state.customReminders.find(item => item.id === payload.key);
  if (reminder) {
    reminder.nextAt = reminder.frequency === 'time'
      ? nextTimeOccurrence(reminder.time, reminder.days, Date.now() + 60000)
      : Date.now() + (reminder.everyMinutes || 60) * 60 * 1000;
  }
  persistState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:state-updated', state);
}

function tickScheduler() {
  if (isQuietTime() || popupWindow?.isVisible()) return;
  const now = Date.now();
  const candidates = [
    ['water', state.reminders.water],
    ['movement', state.reminders.movement],
    ...state.customReminders.map(reminder => [reminder.id, reminder])
  ];

  for (const [key, reminder] of candidates) {
    if (!reminder.enabled) continue;
    if (reminder.frequency !== 'time' && !activeToday(reminder)) continue;
    if (reminder.nextAt && reminder.nextAt <= now) {
      if (key.startsWith('custom-')) {
        showReminder('custom', { key, title: reminder.title, message: reminder.message });
      } else {
        showReminder(key);
      }
      reminder.nextAt = reminder.frequency === 'time'
        ? nextTimeOccurrence(reminder.time, reminder.days, now + 60000)
        : now + (reminder.everyMinutes || 60) * 60 * 1000;
      persistState();
      break;
    }
  }
}

function closePopup() {
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => state);
  ipcMain.handle('app:save-state', (_event, nextState) => {
    const popupPosition = state.popupPosition;
    state = mergeState({ ...nextState, popupPosition });
    ensureNextAt();
    persistState();
    return state;
  });
  ipcMain.handle('app:test-reminder', (_event, key) => {
    showReminder(key === 'custom' ? 'custom' : key);
    return true;
  });
  ipcMain.on('popup:complete', (_event, payload) => {
    recordCompletion(payload);
    closePopup();
  });
  ipcMain.on('popup:open-settings', () => {
    closePopup();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('app:navigate', 'reminders');
    }
  });
  ipcMain.on('app:open-developer-site', () => shell.openExternal(DEVELOPER_URL));
  ipcMain.on('window:action', (_event, action) => {
    if (action === 'minimize' && mainWindow) mainWindow.minimize();
    if (action === 'close' && mainWindow) mainWindow.close();
    if (action === 'popup-close') closePopup();
  });
}

app.whenReady().then(() => {
  loadState();
  registerIpc();
  createMainWindow();
  scheduler = setInterval(tickScheduler, 15000);
});

app.on('window-all-closed', () => {
  if (scheduler) clearInterval(scheduler);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});
