import { icon, pluralize } from './petRenderer.js';

const escape = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = (iso) => new Date(iso).toDateString() === new Date().toDateString();
export const quantity = (value, unit) => unit === 'seconds' ? pluralize(value, 'секунда', 'секунды', 'секунд') : pluralize(value, 'повторение', 'повторения', 'повторений');
export const exerciseTotal = (state, id) => (state.exerciseLog || []).filter(item => item.exerciseId === id && today(item.completedAt)).reduce((sum, item) => sum + item.amount, 0);

export function renderExercises(state) {
  const exercises = state.exercises || [];
  const logs = (state.exerciseLog || []).filter(item => today(item.completedAt)).sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
  document.querySelector('#exercise-day-label').textContent = new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'long'}).format(new Date());
  document.querySelector('#exercise-list').innerHTML = exercises.length ? exercises.map(ex => {
    const total = exerciseTotal(state, ex.id);
    const percent = Math.min(100, total / ex.target * 100);
    return `<article class="exercise-card ${total >= ex.target ? 'goal-done' : ''}"><div class="exercise-card-heading"><div class="exercise-symbol">${icon('movement',22)}</div><button class="icon-button" data-edit-exercise="${escape(ex.id)}" aria-label="Изменить ${escape(ex.name)}">${icon('settings',17)}</button></div><h2>${escape(ex.name)}</h2><div class="exercise-status">${ex.enabled ? 'В напоминаниях' : 'Только ручной учёт'}</div><div class="exercise-value"><strong>${total}</strong><span>/ ${ex.target} ${ex.unit === 'seconds' ? 'сек.' : 'раз'}</span></div><div class="goal-rule" role="progressbar" aria-label="${escape(ex.name)}: дневная цель" aria-valuemin="0" aria-valuemax="${ex.target}" aria-valuenow="${Math.min(total,ex.target)}"><span style="width:${percent}%"></span></div><div class="goal-caption">${total >= ex.target ? 'Цель на сегодня выполнена' : `Осталось ${quantity(ex.target-total,ex.unit)}`}</div><form class="exercise-log-form" data-log-exercise="${escape(ex.id)}"><label class="sr-only" for="amount-${escape(ex.id)}">Сделано: ${escape(ex.name)}</label><input id="amount-${escape(ex.id)}" name="amount" type="number" min="1" max="100000" step="1" value="${ex.perSet}" required /><button class="secondary-button" type="submit">${icon('plus',15)} Записать подход</button></form></article>`;
  }).join('') : '<div class="empty-state">Добавьте первое упражнение и задайте дневную цель.</div>';
  document.querySelector('#exercise-log').innerHTML = logs.length ? logs.map(item => `<div class="history-item"><div class="history-item-icon">${icon('check',18)}</div><div class="history-item-copy"><div class="history-item-title">${escape(item.name)} <span class="log-quantity">+${quantity(item.amount,item.unit)}</span></div><div class="history-item-time">${new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date(item.completedAt))}</div></div><button class="text-button undo-button" data-undo-exercise="${escape(item.id)}">Отменить</button></div>`).join('') : '<div class="empty-state">Сегодня пока нет подходов. Запишите первый, когда будете готовы.</div>';
  const active = exercises.filter(ex => ex.enabled);
  document.querySelector('#overview-goals').innerHTML = `<div class="section-label-row"><h2 class="section-title">Цели на сегодня</h2><button class="text-button" data-view="exercises">Все упражнения ${icon('arrow',15)}</button></div><div class="overview-goal-list">${active.length ? active.slice(0,3).map(ex => {const n=exerciseTotal(state,ex.id);return `<button class="overview-goal" data-view="exercises"><span>${escape(ex.name)}</span><strong>${n} <small>/ ${ex.target} ${ex.unit==='seconds'?'сек.':'раз'}</small></strong><div class="goal-rule"><span style="width:${Math.min(100,n/ex.target*100)}%"></span></div></button>`;}).join('') : '<p class="panel-copy">Добавьте упражнения и выберите, о каких напоминать.</p>'}</div>`;
}

export function bindExercises({getState, save, acceptState, toast, api}) {
  const dialog = document.querySelector('#exercise-dialog');
  const form = document.querySelector('#exercise-form');
  let saving = false;
  const open = (id) => {
    const ex = getState().exercises?.find(e => e.id === id);
    form.reset();
    form.elements.id.value = ex?.id || '';
    form.elements.name.value = ex?.name || '';
    form.elements.target.value = ex?.target || 30;
    form.elements.perSet.value = ex?.perSet || 10;
    form.elements.unit.value = ex?.unit || 'reps';
    form.elements.unit.disabled = Boolean(ex && getState().exerciseLog?.some(l => l.exerciseId === ex.id));
    form.elements.enabled.checked = ex?.enabled ?? true;
    document.querySelector('#exercise-dialog-title').textContent = ex ? 'Изменить упражнение' : 'Новое упражнение';
    dialog.showModal();
    form.elements.name.focus();
  };
  document.querySelector('#add-exercise').addEventListener('click', () => open());
  document.querySelector('#close-exercise-dialog').addEventListener('click', () => dialog.close());
  document.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-exercise]');
    if (edit) return open(edit.dataset.editExercise);
    const undo = event.target.closest('[data-undo-exercise]');
    if (!undo || undo.disabled) return;
    undo.disabled = true;
    try { acceptState(await api.deleteExerciseLog(undo.dataset.undoExercise)); toast('Запись отменена.'); }
    catch { toast('Не удалось отменить запись. Попробуйте ещё раз.'); undo.disabled=false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); return; }
    const next = {id:form.elements.id.value || crypto.randomUUID(),name,unit:form.elements.unit.value,target:Number(form.elements.target.value),perSet:Number(form.elements.perSet.value),enabled:form.elements.enabled.checked};
    const state = getState();
    const before = state.exercises || [];
    state.exercises = before.some(e=>e.id===next.id) ? before.map(e=>e.id===next.id?next:e) : [...before,next];
    saving = true;
    try { await save('Упражнение сохранено.'); dialog.close(); }
    catch { state.exercises=before; toast('Не удалось сохранить упражнение. Попробуйте ещё раз.'); }
    finally { saving=false; }
  });
  document.addEventListener('submit', async event => {
    const logForm = event.target.closest('[data-log-exercise]');
    if (!logForm) return;
    event.preventDefault();
    const button = logForm.querySelector('button');
    if (button.disabled || !logForm.reportValidity()) return;
    button.disabled=true;
    try { acceptState(await api.logExercise({exerciseId:logForm.dataset.logExercise,amount:Number(logForm.elements.amount.value)})); toast('Подход записан.'); }
    catch { toast('Не удалось записать подход. Проверьте количество.'); button.disabled=false; }
  });
}
