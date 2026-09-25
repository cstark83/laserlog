/**
 * LaserLog — job timer.
 *
 * Run time is the number everyone guesses and nobody measures, and it is the
 * one that decides whether a price is right. So the timer is not buried in a
 * form: start it anywhere, and a bar follows you around the app until you
 * stop it. The start time lives in localStorage, so locking the phone,
 * closing the tab or losing the wifi does not lose the job.
 */
import { $, el, esc, icons, num } from './ui.js';

const KEY = 'laserlog.timer';

export function activeTimer() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t?.started) return null;
    return t;
  } catch { return null; }
}

export function startTimer(label = '') {
  localStorage.setItem(KEY, JSON.stringify({ label, started: Date.now() }));
  drawTimerBar();
}

/** Stops the timer and hands back what it measured. */
export function stopTimer() {
  const t = activeTimer();
  localStorage.removeItem(KEY);
  drawTimerBar();
  if (!t) return null;
  const ms = Date.now() - t.started;
  return { label: t.label, ms, minutes: Math.max(ms / 60000, 0) };
}

const clock = (ms) => {
  const s = Math.max(Math.floor(ms / 1000), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? `${h}:` : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
};

let tick = null;

/**
 * Paint the bar. Called on every route change as well as on start and stop,
 * because the shell is re-rendered underneath it.
 */
export function drawTimerBar(onStop) {
  const host = $('#timer-bar');
  if (!host) return;
  if (onStop) drawTimerBar.onStop = onStop;

  const t = activeTimer();
  clearInterval(tick);

  if (!t) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <div class="timerbar">
      <span class="timerbar__dot"></span>
      <span class="timerbar__label">${esc(t.label || 'Job running')}</span>
      <span class="timerbar__clock" id="timer-clock">0:00</span>
      <button class="btn btn--sm" id="timer-stop">Stop</button>
    </div>`;

  const paint = () => {
    const c = $('#timer-clock', host);
    if (c) c.textContent = clock(Date.now() - t.started);
  };
  paint();
  tick = setInterval(paint, 1000);

  $('#timer-stop', host).addEventListener('click', () => {
    const r = stopTimer();
    drawTimerBar.onStop?.(r);
  });
}

/** A start/stop button for a form, which writes the minutes into a field. */
export function timerButton(targetInput, label) {
  const btn = el(`<button type="button" class="btn btn--sm">${icons.sync}<span></span></button>`);
  const sync = () => {
    const running = Boolean(activeTimer());
    btn.querySelector('span').textContent = running ? 'Stop timing' : 'Time this run';
    btn.classList.toggle('btn--primary', running);
  };
  btn.addEventListener('click', () => {
    if (activeTimer()) {
      const r = stopTimer();
      if (r && targetInput) {
        const existing = Number(targetInput.value) || 0;
        targetInput.value = num(existing + r.minutes, 1);
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      startTimer(label);
    }
    sync();
  });
  sync();
  return btn;
}
