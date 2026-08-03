const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let popupWindow;
let tray;
let state;
let scheduler;
let popupMoveSaveTimer;
let popupAutoSnoozeTimer;
let quitting = false;

const APP_NAME = 'Напоминалка';
const DEVELOPER_URL = 'https://bestpracticeai.ru/';
const TICK_MS = 15000;
const POPUP_AUTO_SNOOZE_MS = 5 * 60 * 1000;

app.setName(APP_NAME);

function createDefaultState() {
  const now = Date.now();
  return {
    onboardingComplete: false,
    petId: 'winnie',
    soundEnabled: true,
    volume: 0.65,
    autostart: false,
    snoozeMinutes: 10,
    popupPosition: null,
    quietHours: { enabled: true, from: '22:00', to: '07:00' },
    reminders: {
      water: {
        enabled: true,
        everyMinutes: 60,
        frequency: 'interval',
        time: '09:00',
        days: [1, 2, 3, 4, 5],
        nextAt: now + 60 * 60 * 1000
      },
      movement: {
        enabled: true,
        everyMinutes: 120,
        frequency: 'interval',
        time: '09:00',
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
    if (reminder.frequency === 'time') {
      if (!reminder.nextAt || reminder.nextAt <= now) {
        reminder.nextAt = nextTimeOccurrence(reminder.time, reminder.days, now);
      }
    } else if (!reminder.nextAt || reminder.nextAt < now - 24 * 60 * 60 * 1000) {
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

function applyAutostart() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(state.autostart), openAsHidden: true });
  } catch {
    // На некоторых системах автозапуск недоступен — это не повод падать.
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
    if (url.startsWith(DEVELOPER_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Закрытие окна прячет приложение в трей: напоминания должны продолжать работать.
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow(view) {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (view) mainWindow.webContents.send('app:navigate', view);
}

function trayImage() {
  const file = path.join(__dirname, 'assets', 'icons', 'tray.png');
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  const resized = image.resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') resized.setTemplateImage(true);
  return resized;
}

function createTray() {
  const image = trayImage();
  if (!image) return;
  try {
    tray = new Tray(image);
  } catch {
    return;
  }
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Напоминалку', click: () => showMainWindow('overview') },
    { type: 'separator' },
    { label: 'Напомнить о воде сейчас', click: () => showReminder('water') },
    { label: 'Напомнить о разминке сейчас', click: () => showReminder('movement') },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
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
      width: 420,
      height: 200,
      minWidth: 420,
      minHeight: 200,
      maxWidth: 420,
      maxHeight: 200,
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
      // skipTransformProcessType обязателен: без него Electron вызывает DockHide()
      // и приложение пропадает из Dock после первого же напоминания.
      popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    popupWindow.loadFile(path.join(__dirname, 'src', 'popup.html'));
    popupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popupWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    popupWindow.on('move', rememberPopupPosition);
    popupWindow.on('closed', () => {
      clearTimeout(popupMoveSaveTimer);
      clearTimeout(popupAutoSnoozeTimer);
      popupWindow = null;
    });
  }

  const sendPayload = () => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    popupWindow.webContents.send('popup:reminder', payload);
    positionPopup();
    // showInactive намеренно: напоминание не должно выдёргивать курсор из работы.
    popupWindow.showInactive();
    clearTimeout(popupAutoSnoozeTimer);
    popupAutoSnoozeTimer = setTimeout(() => snoozeReminder(payload), POPUP_AUTO_SNOOZE_MS);
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

function findReminder(key) {
  if (state.reminders[key]) return state.reminders[key];
  return state.customReminders.find((item) => item.id === key);
}

function rescheduleAfter(key, from) {
  const reminder = findReminder(key);
  if (!reminder) return;
  reminder.nextAt = reminder.frequency === 'time'
    ? nextTimeOccurrence(reminder.time, reminder.days, from + 60000)
    : from + (reminder.everyMinutes || 60) * 60 * 1000;
}

// Главный процесс отправляет только данные. Текст собирает интерфейс —
// там же, где лежат имена питомцев.
function buildPayload(key) {
  const reminder = findReminder(key);
  const type = key === 'water' || key === 'movement' ? key : 'custom';
  return {
    id: `${key}-${Date.now()}`,
    key,
    type,
    petId: state.petId,
    soundEnabled: state.soundEnabled,
    volume: state.volume,
    snoozeMinutes: state.snoozeMinutes || 10,
    createdAt: new Date().toISOString(),
    exercise: type === 'movement' ? state.reminders.movement.exercise : undefined,
    amount: type === 'movement' ? state.reminders.movement.amount : undefined,
    title: type === 'custom' ? reminder?.title : undefined,
    message: type === 'custom' ? reminder?.message : undefined
  };
}

function showReminder(key) {
  if (!findReminder(key)) return;
  const payload = buildPayload(key);
  createPopupWindow(payload);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:reminder-shown', payload);
}

function closePopup() {
  clearTimeout(popupAutoSnoozeTimer);
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
}

function snoozeReminder(payload) {
  const minutes = Number(state.snoozeMinutes) || 10;
  const reminder = findReminder(payload?.key);
  if (reminder) {
    reminder.nextAt = Date.now() + minutes * 60 * 1000;
    persistState();
  }
  closePopup();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:state-updated', state);
}

function recordCompletion(payload) {
  state.history.push({
    id: payload.id,
    key: payload.key,
    type: payload.type,
    title: payload.type === 'custom' ? payload.title : undefined,
    petId: state.petId,
    completedAt: new Date().toISOString()
  });
  state.history = state.history.slice(-50);
  rescheduleAfter(payload.key, Date.now());
  persistState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:state-updated', state);
}

function tickScheduler() {
  if (isQuietTime() || popupWindow?.isVisible()) return;
  const now = Date.now();
  const candidates = [
    ['water', state.reminders.water],
    ['movement', state.reminders.movement],
    ...state.customReminders.map((reminder) => [reminder.id, reminder])
  ];

  for (const [key, reminder] of candidates) {
    if (!reminder.enabled) continue;
    if (reminder.frequency !== 'time' && !activeToday(reminder)) continue;
    if (reminder.nextAt && reminder.nextAt <= now) {
      showReminder(key);
      rescheduleAfter(key, now);
      persistState();
      break;
    }
  }
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => state);
  ipcMain.handle('app:save-state', (_event, nextState) => {
    const popupPosition = state.popupPosition;
    const wasAutostart = state.autostart;
    state = mergeState({ ...nextState, popupPosition });
    ensureNextAt();
    persistState();
    if (state.autostart !== wasAutostart) applyAutostart();
    return state;
  });
  ipcMain.handle('app:test-reminder', (_event, key) => {
    showReminder(typeof key === 'string' ? key : 'water');
    return true;
  });
  ipcMain.on('popup:complete', (_event, payload) => {
    recordCompletion(payload);
    closePopup();
  });
  ipcMain.on('popup:snooze', (_event, payload) => snoozeReminder(payload));
  ipcMain.on('popup:open-settings', () => {
    closePopup();
    showMainWindow('reminders');
  });
  ipcMain.on('app:open-developer-site', () => shell.openExternal(DEVELOPER_URL));
  ipcMain.on('window:action', (_event, action) => {
    if (action === 'minimize' && mainWindow) mainWindow.minimize();
    if (action === 'close' && mainWindow) mainWindow.close();
    if (action === 'popup-close') closePopup();
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    loadState();
    registerIpc();
    createTray();
    createMainWindow();
    applyAutostart();
    scheduler = setInterval(tickScheduler, TICK_MS);
  });
}

app.on('before-quit', () => {
  quitting = true;
  if (scheduler) clearInterval(scheduler);
});

// Приложение живёт в трее: закрытое окно не должно останавливать напоминания.
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

app.on('activate', () => showMainWindow());
