import { pet, petSprite, setPetAnimation, startPetAnimations, reminderText, icon } from './petRenderer.js';

let currentPayload;
let activeAudio;
let completionTimer;
let soundTimer;
let completing = false;

const $ = (selector) => document.querySelector(selector);

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

$('#popup-settings').innerHTML = icon('settings', 15);
window.desktopApi.onPopupReminder(render);
startPetAnimations();
