import { PETS, petSprite, setPetAnimation, startPetAnimations } from './petRenderer.js';

let currentPayload;
let activeAudio;

const $ = (selector) => document.querySelector(selector);

function playSound(petId, volume = 0.65) {
  if (!currentPayload?.soundEnabled || volume <= 0) return;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  activeAudio = new Audio(PETS[petId]?.soundFile || PETS.winnie.soundFile);
  activeAudio.volume = Math.max(0, Math.min(1, volume));
  activeAudio.play().catch(() => {});
}

function render(payload) {
  currentPayload = payload;
  const pet = PETS[payload.petId] || PETS.winnie;
  document.documentElement.style.setProperty('--pet-accent', pet.accent);
  $('#popup-pet').innerHTML = petSprite(payload.petId, { motion: 'waiting' });
  $('#popup-eyebrow').textContent = payload.eyebrow || 'МАЛЕНЬКАЯ ПАУЗА';
  $('#popup-title').textContent = payload.title;
  $('#popup-message').textContent = payload.message;
  $('#popup-action').textContent = payload.action || 'Готово';
  $('#popup-time').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(payload.createdAt));
  $('#popup-shell').classList.remove('is-complete');
  setTimeout(() => playSound(payload.petId, payload.volume), 140);
}

$('#popup-complete').addEventListener('click', () => {
  if (!currentPayload) return;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  $('#popup-shell').classList.add('is-complete');
  setPetAnimation($('#popup-pet .pet-sprite'), 'jumping');
  setTimeout(() => window.desktopApi.completePopup(currentPayload), 980);
});

$('#popup-settings').addEventListener('click', () => window.desktopApi.openSettings());
window.desktopApi.onPopupReminder(render);
startPetAnimations();
