export const PETS = {
  winnie: {
    name: 'Винни',
    species: 'рыжий той-пудель',
    short: 'Пудель',
    accent: '#ef7b4f',
    soft: '#fff0e8',
    greeting: 'Гавкает, когда пора отойти от экрана.',
    soundFile: '../assets/sounds/winnie-bark.mp3',
    atlas: '../assets/pets/winnie/spritesheet.webp'
  },
  max: {
    name: 'Макс',
    species: 'чёрно-белый котёнок',
    short: 'Котёнок',
    accent: '#6b7f96',
    soft: '#edf2f8',
    greeting: 'Мурлычет и ждёт, пока встанешь из-за стола.',
    soundFile: '../assets/sounds/max-purr.mp3',
    atlas: '../assets/pets/max/spritesheet.webp'
  },
  sovushka: {
    name: 'Совушка',
    species: 'фиолетовая сова',
    short: 'Сова',
    accent: '#8b6ad8',
    soft: '#f1ecff',
    greeting: 'Ухает тихо, чтобы не сбить с мысли.',
    soundFile: '../assets/sounds/sovushka-hoot.mp3',
    atlas: '../assets/pets/sovushka/spritesheet.webp'
  },
  belochka: {
    name: 'Белочка',
    species: 'рыжая белочка',
    short: 'Белочка',
    accent: '#d76d3f',
    soft: '#fff0e1',
    greeting: 'Щёлкает орехом, когда пора размяться.',
    soundFile: '../assets/sounds/belochka-nut-crack.mp3',
    atlas: '../assets/pets/belochka/spritesheet.webp'
  }
};

export const PET_ORDER = ['winnie', 'max', 'sovushka', 'belochka'];

export function pet(petId) {
  return PETS[petId] || PETS.winnie;
}

// Атлас содержит только те ряды, которые приложение действительно показывает.
// Порядок рядов задан в scripts/pack_atlas.py и должен совпадать с ним.
const ATLAS_COLUMNS = 18;
const ATLAS_ROWS = 5;

// Кадры внутри цикла идут через равные промежутки. Раньше длительности были
// разными (55 мс против 160 мс), и движение спотыкалось на длинных кадрах.
export const PET_ANIMATIONS = {
  idle: { row: 0, frames: 18, cycleMs: 1200 },
  waving: { row: 1, frames: 12, cycleMs: 800 },
  jumping: { row: 2, frames: 15, cycleMs: 880 },
  waiting: { row: 3, frames: 18, cycleMs: 1080 },
  review: { row: 4, frames: 18, cycleMs: 1100 }
};

const animationState = new WeakMap();
let animationLoopStarted = false;

export function petSprite(petId = 'winnie', options = {}) {
  const current = pet(petId);
  const state = PET_ANIMATIONS[options.motion] ? options.motion : 'idle';
  const label = `${current.name}, ${current.species}`;
  return `<div class="pet-sprite pet-${petId}" data-pet-state="${state}" role="img" aria-label="${label}" style="--pet-atlas:url('${current.atlas}')"></div>`;
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
    record = { stateName, startedAt: now, frame: -1 };
    animationState.set(element, record);
  }

  let frame = 0;
  if (!reducedMotion) {
    const elapsed = (now - record.startedAt) % animation.cycleMs;
    frame = Math.min(animation.frames - 1, Math.floor((elapsed / animation.cycleMs) * animation.frames));
  }

  // Кадр не сменился — не трогаем стиль, иначе браузер пересчитывает его 60 раз в секунду.
  if (frame === record.frame) return;
  record.frame = frame;
  const x = (frame / (ATLAS_COLUMNS - 1)) * 100;
  const y = (animation.row / (ATLAS_ROWS - 1)) * 100;
  element.style.backgroundPosition = `${x}% ${y}%`;
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
    snooze: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>',
    trash: '<path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3M7 7l1 13h8l1-13"/>'
  };
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

// Русские числительные: 1 минута, 2 минуты, 5 минут.
export function plural(count, one, few, many) {
  const value = Math.abs(Math.round(count));
  const withinHundred = value % 100;
  const lastDigit = value % 10;
  if (withinHundred >= 11 && withinHundred <= 14) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

export function pluralize(count, one, few, many) {
  return `${count} ${plural(count, one, few, many)}`;
}

export function formatInterval(minutes) {
  const value = Number(minutes) || 60;
  if (value < 60) return `каждые ${pluralize(value, 'минуту', 'минуты', 'минут')}`;
  if (value === 60) return 'каждый час';
  if (value === 90) return 'каждые полтора часа';
  const hours = value / 60;
  if (Number.isInteger(hours)) return `каждые ${pluralize(hours, 'час', 'часа', 'часов')}`;
  return `каждые ${String(hours).replace('.', ',')} часа`;
}

export function formatNextTime(nextAt) {
  if (!nextAt) return 'когда включишь';
  const diff = Math.max(0, nextAt - Date.now());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'меньше минуты';
  if (minutes < 60) return `через ${pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
  const hours = Math.round(minutes / 60);
  return `через ${pluralize(hours, 'час', 'часа', 'часов')}`;
}

// Тексты напоминаний живут рядом с интерфейсом, а не в главном процессе,
// чтобы имя питомца и его род не приходилось дублировать в двух местах.
export function reminderText(payload = {}) {
  const current = pet(payload.petId);
  if (payload.type === 'movement') {
    const exercise = payload.exercise || 'Небольшая разминка';
    const amount = payload.amount || 'пара повторений';
    return {
      eyebrow: 'Разминка',
      title: 'Пора размяться',
      message: `${exercise}, ${amount}. ${current.name} подождёт рядом.`,
      action: 'Готово'
    };
  }
  if (payload.type === 'water') {
    return {
      eyebrow: 'Вода',
      title: 'Пора выпить воды',
      message: 'Пара глотков, и голова снова работает.',
      action: 'Готово'
    };
  }
  return {
    eyebrow: 'Своё напоминание',
    title: payload.title || 'Пора сделать паузу',
    message: payload.message || 'Отойди от экрана на минуту.',
    action: 'Готово'
  };
}
