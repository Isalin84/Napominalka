// Допуск на расхождение часов окна и главного процесса: отсчёт в окне
// стартует чуть позже createdAt, и честно выждавшего нельзя отбрасывать.
const TOLERANCE_MS = 1000;

const NO_GATE = Object.freeze({ kind: 'none' });

function gateFor(payload, state) {
  if (!state?.hardMode?.enabled) return NO_GATE;
  if (payload?.type !== 'movement' || !payload.exerciseId) return NO_GATE;
  // Без пригодной длительности ворота не ставим, иначе кнопка не откроется никогда.
  const seconds = payload.holdSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return NO_GATE;
  // confirmBy пока не разветвляет поведение: любое значение даёт таймер.
  return { kind: 'timer', seconds };
}

function isSatisfied(gate, signal) {
  if (!gate || gate.kind !== 'timer') return true;
  const elapsedMs = signal?.elapsedMs;
  // Цена ошибки несимметрична: незаработанный подход дешевле запертого окна.
  if (!Number.isFinite(elapsedMs)) return true;
  return elapsedMs >= gate.seconds * 1000 - TOLERANCE_MS;
}

module.exports = {
  TOLERANCE_MS,
  gateFor,
  isSatisfied
};
