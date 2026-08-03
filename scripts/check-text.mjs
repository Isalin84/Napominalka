import { plural, pluralize, formatInterval, formatNextTime, reminderText, PET_ANIMATIONS } from '../src/petRenderer.js';

let fails = 0;
const eq = (got, want, label) => {
  const ok = got === want;
  if (!ok) fails += 1;
  console.log(`${ok ? '  ok' : 'ПРОВАЛ'}  ${label.padEnd(28)} → «${got}»${ok ? '' : `  (ждали «${want}»)`}`);
};

console.log('\n— formatInterval —');
eq(formatInterval(30), 'каждые 30 минут', '30 мин');
eq(formatInterval(45), 'каждые 45 минут', '45 мин');
eq(formatInterval(60), 'каждый час', '60 мин');
eq(formatInterval(90), 'каждые полтора часа', '90 мин');
eq(formatInterval(120), 'каждые 2 часа', '120 мин');
eq(formatInterval(180), 'каждые 3 часа', '180 мин');
eq(formatInterval(240), 'каждые 4 часа', '240 мин');

console.log('\n— formatNextTime —');
const io = (m) => Date.now() + m * 60000 + 1000;
eq(formatNextTime(io(0.2)), 'меньше минуты', 'сейчас');
eq(formatNextTime(io(1)), 'через 1 минуту', '1 мин');
eq(formatNextTime(io(2)), 'через 2 минуты', '2 мин');
eq(formatNextTime(io(5)), 'через 5 минут', '5 мин');
eq(formatNextTime(io(21)), 'через 21 минуту', '21 мин');
eq(formatNextTime(io(60)), 'через 1 час', '1 час');
eq(formatNextTime(io(120)), 'через 2 часа', '2 часа');
eq(formatNextTime(io(300)), 'через 5 часов', '5 часов');
eq(formatNextTime(null), 'когда включишь', 'выключено');

console.log('\n— склонения —');
eq(pluralize(1, 'пауза', 'паузы', 'пауз'), '1 пауза', '1');
eq(pluralize(3, 'пауза', 'паузы', 'пауз'), '3 паузы', '3');
eq(pluralize(11, 'пауза', 'паузы', 'пауз'), '11 пауз', '11');
eq(pluralize(21, 'пауза', 'паузы', 'пауз'), '21 пауза', '21');
eq(pluralize(0, 'глоток', 'глотка', 'глотков'), '0 глотков', '0');
eq(plural(2, 'час', 'часа', 'часов'), 'часа', 'plural(2)');

console.log('\n— тексты напоминаний (род питомца) —');
for (const petId of ['winnie', 'max', 'sovushka', 'belochka']) {
  const t = reminderText({ type: 'movement', petId, exercise: 'Приседания', amount: '12 раз' });
  console.log(`  ${petId.padEnd(9)} ${t.message}`);
}
eq(reminderText({ type: 'water', petId: 'sovushka' }).title, 'Пора выпить воды', 'вода');
eq(reminderText({ type: 'custom', petId: 'max', title: 'Проветрить' }).title, 'Проветрить', 'своё');

console.log('\n— атлас: кадры и ряды в пределах сетки 18x5 —');
for (const [name, a] of Object.entries(PET_ANIMATIONS)) {
  eq(a.frames <= 18 && a.row <= 4, true, `${name} ряд ${a.row}, ${a.frames} кадр.`);
}
console.log('\n— тайминг: кадр держится от 50 до 160 мс —');
for (const [name, a] of Object.entries(PET_ANIMATIONS)) {
  const perFrame = Math.round(a.cycleMs / a.frames);
  eq(perFrame >= 50 && perFrame <= 160, true, `${name} ${perFrame} мс на кадр`);
}

// Спокойные состояния должны идти заметно медленнее жестов, иначе питомец
// в углу экрана дёргается. Именно на этом попап и попался.
console.log('\n— спокойные состояния медленнее жестов —');
const calm = Math.min(PET_ANIMATIONS.idle.cycleMs, PET_ANIMATIONS.waiting.cycleMs, PET_ANIMATIONS.review.cycleMs);
const brisk = Math.max(PET_ANIMATIONS.waving.cycleMs, PET_ANIMATIONS.jumping.cycleMs);
eq(calm >= brisk * 2, true, `спокойные ${calm} мс, жесты ${brisk} мс`);

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nвсё сходится');
process.exit(fails ? 1 : 0);
