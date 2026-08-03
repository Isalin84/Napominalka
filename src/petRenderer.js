export const PETS = {
  winnie: {
    name: 'Винни',
    species: 'рыжий той-пудель',
    short: 'Пудель',
    accent: '#ef7b4f',
    soft: '#fff0e8',
    ink: '#5d2a1d',
    greeting: 'Твой тёплый напарник для коротких пауз.',
    sound: 'Гав-гав',
    soundFile: '../assets/sounds/winnie-bark.mp3',
    atlas: '../assets/pets/winnie/spritesheet.webp'
  },
  max: {
    name: 'Макс',
    species: 'черно-белый котёнок',
    short: 'Котёнок',
    accent: '#6b7f96',
    soft: '#edf2f8',
    ink: '#202a36',
    greeting: 'Любопытный наблюдатель, который знает цену паузе.',
    sound: 'Мр-р-р',
    soundFile: '../assets/sounds/max-purr.mp3',
    atlas: '../assets/pets/max/spritesheet.webp'
  },
  sovushka: {
    name: 'Совушка',
    species: 'фиолетовая сова',
    short: 'Сова',
    accent: '#8b6ad8',
    soft: '#f1ecff',
    ink: '#3e2e6d',
    greeting: 'Спокойный ночной стратег для ритма без перегруза.',
    sound: 'Ух-уух',
    soundFile: '../assets/sounds/sovushka-hoot.mp3',
    atlas: '../assets/pets/sovushka/spritesheet.webp'
  },
  belochka: {
    name: 'Белочка',
    species: 'рыжая белочка',
    short: 'Белочка',
    accent: '#d76d3f',
    soft: '#fff0e1',
    ink: '#572d20',
    greeting: 'Энергичная хранительница маленьких полезных привычек.',
    sound: 'Щёлк-щёлк',
    soundFile: '../assets/sounds/belochka-nut-crack.mp3',
    atlas: '../assets/pets/belochka/spritesheet.webp'
  }
};

export const PET_ORDER = ['winnie', 'max', 'sovushka', 'belochka'];

export const REMINDER_CATALOG = {
  water: {
    label: 'Вода',
    description: 'Мягко напоминает сделать несколько глотков.',
    icon: 'water',
    color: '#59a9d5'
  },
  movement: {
    label: 'Разминка',
    description: 'Подсказывает встать, потянуться или сделать упражнение.',
    icon: 'movement',
    color: '#df8b55'
  }
};

const smoothDurations = (durations) => durations.flatMap((duration) => {
  const firstHalf = Math.round(duration / 2);
  return [firstHalf, duration - firstHalf];
});

export const PET_ANIMATIONS = {
  idle: { row: 0, durations: smoothDurations([280, 110, 110, 140, 140, 320]) },
  'running-right': { row: 1, durations: smoothDurations([120, 120, 120, 120, 120, 120, 120, 220]) },
  'running-left': { row: 2, durations: smoothDurations([120, 120, 120, 120, 120, 120, 120, 220]) },
  waving: { row: 3, durations: smoothDurations([140, 140, 140, 280]) },
  jumping: { row: 4, durations: smoothDurations([140, 140, 140, 140, 280]) },
  failed: { row: 5, durations: smoothDurations([140, 140, 140, 140, 140, 140, 140, 240]) },
  waiting: { row: 6, durations: smoothDurations([150, 150, 150, 150, 150, 260]) },
  running: { row: 7, durations: smoothDurations([120, 120, 120, 120, 120, 220]) },
  review: { row: 8, durations: smoothDurations([150, 150, 150, 150, 150, 280]) }
};

const animationState = new WeakMap();
let animationLoopStarted = false;

export function petSprite(petId = 'winnie', options = {}) {
  const pet = PETS[petId] || PETS.winnie;
  const state = PET_ANIMATIONS[options.motion] ? options.motion : 'idle';
  const label = `${pet.name}, ${pet.species}`;
  return `<div class="pet-sprite pet-${petId}" data-pet-state="${state}" role="img" aria-label="${label}" style="--pet-atlas:url('${pet.atlas}')"></div>`;
}

export function setPetAnimation(target, state) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!element || !PET_ANIMATIONS[state]) return;
  element.dataset.petState = state;
  animationState.delete(element);
}

function animationFrame(element, now, reducedMotion) {
  const stateName = PET_ANIMATIONS[element.dataset.petState] ? element.dataset.petState : 'idle';
  const animation = PET_ANIMATIONS[stateName];
  let record = animationState.get(element);
  if (!record || record.stateName !== stateName) {
    record = { stateName, startedAt: now };
    animationState.set(element, record);
  }

  let frame = 0;
  if (!reducedMotion) {
    const cycle = animation.durations.reduce((sum, duration) => sum + duration, 0);
    let elapsed = (now - record.startedAt) % cycle;
    for (let index = 0; index < animation.durations.length; index += 1) {
      if (elapsed < animation.durations[index]) {
        frame = index;
        break;
      }
      elapsed -= animation.durations[index];
    }
  }

  element.style.backgroundPosition = `${(frame / 15) * 100}% ${(animation.row / 10) * 100}%`;
}

export function startPetAnimations() {
  if (animationLoopStarted) return;
  animationLoopStarted = true;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tick = (now) => {
    document.querySelectorAll('.pet-sprite').forEach((element) => animationFrame(element, now, reducedMotion.matches));
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

export function icon(name, size = 18) {
  const paths = {
    spark: '<path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z"/><path d="M19 17l.6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z"/>',
    water: '<path d="M12 3.2S6.5 9.5 6.5 13.8a5.5 5.5 0 0 0 11 0C17.5 9.5 12 3.2 12 3.2Z"/><path d="M9.2 15.2a3.2 3.2 0 0 0 3.1 2.1"/>',
    movement: '<circle cx="12" cy="5" r="2.2"/><path d="M9.5 22l1.8-6.1-3.1-2.8 2.2-4.2 3.6 2.2 3.2-1.5M13.4 11.1l1.8 3.6 3.5.9M11 15.9l-4.4 1.3"/>',
    clock: '<circle cx="12" cy="12" r="8.7"/><path d="M12 7v5l3.5 2"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3v4M16 3v4M4 9.5h16"/>',
    volume: '<path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/>',
    volumeOff: '<path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.6h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3.8h2.6V4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2.6h-.2a1.7 1.7 0 0 0-1.6 1Z"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 5v4h4M12 7v5l3 2"/>',
    check: '<path d="m5 12 4.2 4L19 6"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    minimize: '<path d="M5 12h14"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
    trash: '<path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3M7 7l1 13h8l1-13"/>'
  };
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

export function formatInterval(minutes) {
  if (minutes < 60) return `каждые ${minutes} мин`;
  const hours = minutes / 60;
  return `каждые ${hours === 1 ? '1 час' : `${hours} ч`}`;
}

export function formatDateTime(iso) {
  if (!iso) return 'ещё не было';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
