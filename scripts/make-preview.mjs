// Собирает стенд для визуальной проверки интерфейса в обычном браузере:
// берёт src/index.html, снимает CSP и подставляет заглушку вместо desktopApi.
// Файл временный, в сборку не попадает (см. .gitignore).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();

const state = {
  onboardingComplete: true,
  petId: 'winnie',
  soundEnabled: true,
  volume: 0.65,
  autostart: false,
  snoozeMinutes: 10,
  quietHours: { enabled: true, from: '22:00', to: '07:00' },
  reminders: {
    water: { enabled: true, everyMinutes: 60, frequency: 'interval', time: '09:00', days: [1, 2, 3, 4, 5], nextAt: now + 21 * 60_000 },
    movement: { enabled: true, everyMinutes: 120, frequency: 'interval', time: '09:00', days: [1, 2, 3, 4, 5], exercise: 'Приседания', amount: '12 раз', nextAt: now + 95 * 60_000 }
  },
  customReminders: [
    { id: 'custom-1', title: 'Проветрить комнату', message: 'Открой окно на пару минут.', enabled: true, everyMinutes: 180, frequency: 'interval', time: '15:00', days: [1, 2, 3, 4, 5], nextAt: now + 140 * 60_000 },
    { id: 'custom-2', title: 'Отдых для глаз', message: 'Посмотри в окно двадцать секунд.', enabled: false, everyMinutes: 60, frequency: 'time', time: '16:30', days: [1, 3, 5], nextAt: now + 300 * 60_000 }
  ],
  history: [
    { id: 'h1', key: 'water', type: 'water', petId: 'winnie', completedAt: hoursAgo(1) },
    { id: 'h2', key: 'movement', type: 'movement', petId: 'winnie', completedAt: hoursAgo(2) },
    { id: 'h3', key: 'water', type: 'water', petId: 'winnie', completedAt: hoursAgo(3) },
    { id: 'h4', key: 'custom-1', type: 'custom', title: 'Проветрить комнату', petId: 'winnie', completedAt: hoursAgo(5) },
    { id: 'h5', key: 'water', type: 'water', petId: 'winnie', completedAt: hoursAgo(26) }
  ]
};

const stub = `<script>
  const STATE = ${JSON.stringify(state)};
  const noop = () => () => {};
  window.desktopApi = {
    getState: async () => STATE,
    saveState: async (next) => Object.assign(STATE, next),
    testReminder: async () => true,
    completePopup: () => {}, snoozePopup: () => {}, openSettings: () => {},
    openDeveloperSite: () => {}, windowAction: () => {},
    onStateUpdated: noop, onReminderShown: noop, onNavigate: noop, onPopupReminder: noop
  };
</script>`;

const preview = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script type="module" src="./app.js"></script>', `${stub}\n    <script type="module" src="./app.js"></script>`);

writeFileSync(join(root, 'src', 'preview-harness.html'), preview);
console.log('стенд собран: src/preview-harness.html');
