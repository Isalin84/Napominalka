import { pet, petSprite, setPetAnimation, startPetAnimations, reminderText, icon, formatHold } from './petRenderer.js';

let currentPayload;
let activeAudio;
let completionTimer;
let soundTimer;
let holdTimer;
let hintTimer;
let escTimer;
let completing = false;

const HINT_DELAY_MS = 5000;
const ESC_HOLD_MS = 3000;

const $ = (selector) => document.querySelector(selector);

function stopHold() {
  clearInterval(holdTimer);
  clearTimeout(hintTimer);
}

// Отсчёт идёт от createdAt, а не от момента отрисовки: перерисованное окно
// не должно заставлять ждать заново.
function startHold(payload, action) {
  const endsAt = new Date(payload.createdAt).getTime() + payload.holdSeconds * 1000;
  const tick = () => {
    const left = Math.ceil((endsAt - Date.now()) / 1000);
    if (left > 0) {
      $('#popup-complete').disabled = true;
      $('#popup-action').textContent = `Готово через ${formatHold(left)}`;
      return;
    }
    clearInterval(holdTimer);
    $('#popup-complete').disabled = false;
    $('#popup-action').textContent = action;
  };
  tick();
  holdTimer = setInterval(tick, 1000);
  // С задержкой намеренно: способ обхода, показанный сразу, читается
  // как предложение им воспользоваться.
  hintTimer = setTimeout(() => { $('#popup-hint').hidden = false; }, HINT_DELAY_MS);
}

function stopSound() {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
}

function playSound(petId, volume = 0.65) {
  if (!currentPayload?.soundEnabled || volume <= 0) return;
  stopSound();
  activeAudio = new Audio(pet(petId).soundFile);
  activeAudio.volume = Math.max(0, Math.min(1, volume));
  activeAudio.play().catch(() => {});
}

function render(payload) {
  clearTimeout(completionTimer);
  clearTimeout(soundTimer);
  stopHold();
  stopSound();
  completing = false;
  $('#popup-complete').disabled = false;
  $('#popup-snooze').disabled = false;
  currentPayload = payload;
  const current = pet(payload.petId);
  const text = reminderText(payload);
  document.documentElement.style.setProperty('--pet-accent', current.accent);
  $('#popup-pet').innerHTML = petSprite(payload.petId, { motion: 'waiting' });
  $('#popup-eyebrow').textContent = text.eyebrow;
  $('#popup-title').textContent = text.title;
  $('#popup-message').textContent = text.message;
  $('#popup-action').textContent = text.action;
  $('#popup-time').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(payload.createdAt));
  $('#popup-snooze').textContent = `Отложить ${payload.snoozeMinutes || 10} мин`;
  $('#popup-shell').classList.remove('is-complete');
  const trackAmount = payload.type === 'movement' && payload.exerciseId;
  $('#popup-amount-row').hidden = !trackAmount;
  $('#popup-amount').value = payload.suggestedAmount || 10;
  $('#popup-unit').textContent = payload.unit === 'seconds' ? 'сек.' : 'раз';
  if (trackAmount) $('#popup-action').textContent = 'Записать';
  // Шестерёнка открывает настройки и закрывает попап, то есть в жёстком режиме
  // это выход мимо отсрочки. Прячется и возвращается при каждой отрисовке:
  // окно переиспользуется между напоминаниями.
  $('#popup-settings').hidden = Boolean(payload.hardMode);
  $('#popup-hint').hidden = true;
  if (payload.hardMode) startHold(payload, $('#popup-action').textContent);
  soundTimer = setTimeout(() => playSound(payload.petId, payload.volume), 140);
}

$('#popup-complete').addEventListener('click', () => {
  if (!currentPayload || completing) return;
  const payload = { ...currentPayload };
  if (payload.exerciseId) {
    if (!$('#popup-amount').reportValidity()) return;
    payload.amountCompleted = Number($('#popup-amount').value);
  }
  completing = true;
  $('#popup-complete').disabled = true;
  $('#popup-snooze').disabled = true;
  stopHold();
  stopSound();
  $('#popup-shell').classList.add('is-complete');
  setPetAnimation($('#popup-pet .pet-sprite'), 'jumping');
  completionTimer = setTimeout(() => window.desktopApi.completePopup(payload), 980);
});

$('#popup-snooze').addEventListener('click', () => {
  if (completing) return;
  stopSound();
  window.desktopApi.snoozePopup(currentPayload);
});

$('#popup-settings').addEventListener('click', () => {
  clearTimeout(completionTimer);
  clearTimeout(soundTimer);
  stopSound();
  window.desktopApi.openSettings();
});

// Esc с удержанием: в жёстком режиме это основной способ отложить, и работает
// он надёжно именно потому, что окно само держит фокус.
const cancelEsc = () => {
  clearTimeout(escTimer);
  escTimer = undefined;
};

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.repeat || escTimer) return;
  escTimer = setTimeout(() => {
    escTimer = undefined;
    if (completing || !currentPayload) return;
    stopHold();
    stopSound();
    window.desktopApi.snoozePopup(currentPayload);
  }, ESC_HOLD_MS);
});

document.addEventListener('keyup', (event) => {
  if (event.key === 'Escape') cancelEsc();
});

window.addEventListener('blur', cancelEsc);

$('#popup-settings').innerHTML = icon('settings', 15);
window.desktopApi.onPopupReminder(render);
startPetAnimations();
