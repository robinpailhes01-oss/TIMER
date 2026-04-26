/* FocusFlow — Pomodoro timer + tasks + stats
   Pure vanilla JS, persisted in localStorage.
*/

const STORE_KEY = 'focusflow.v1';

const defaultStore = () => ({
  tasks: [],
  sessions: [], // {id, taskId|null, taskTitle, mode:'focus'|'short'|'long', durationSec, finishedAt}
  settings: { focus: 25, short: 5, long: 15, sound: true, vibrate: true },
  activeTaskId: null,
});

const load = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    return { ...defaultStore(), ...JSON.parse(raw) };
  } catch { return defaultStore(); }
};
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

let state = load();

/* ============================== NAV ============================== */
const screens = document.querySelectorAll('.screen');
const tabs = document.querySelectorAll('.tab');

function navigate(target) {
  if (target === 'quick') {
    navigate('tasks');
    setTimeout(() => document.getElementById('taskInput')?.focus(), 250);
    return;
  }
  screens.forEach(s => s.classList.toggle('active', s.dataset.screen === target));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.nav === target));
  if (target === 'stats') renderStats();
  if (target === 'profile') renderProfile();
  if (target === 'tasks') renderTasks();
}

document.body.addEventListener('click', e => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) {
    e.preventDefault();
    navigate(navEl.dataset.nav);
  }
});

/* ============================== TIMER ============================== */
const RING_CIRC = 2 * Math.PI * 96; // r=96
const ringFg = document.getElementById('ringProgress');
const ringKnob = document.getElementById('ringKnob');
const timerValueEl = document.getElementById('timerValue');
const timerLabelEl = document.getElementById('timerLabel');
const timerHintEl = document.getElementById('timerHint');
const btnPlay = document.getElementById('btnPlay');
const btnReset = document.getElementById('btnReset');
const btnSkip = document.getElementById('btnSkip');
const modeBtns = document.querySelectorAll('.mode');
const dingSound = document.getElementById('dingSound');

ringFg.setAttribute('stroke-dasharray', RING_CIRC);
ringFg.setAttribute('stroke-dashoffset', RING_CIRC);

let timer = {
  mode: 'focus',
  durationSec: state.settings.focus * 60,
  remainingSec: state.settings.focus * 60,
  intervalId: null,
  running: false,
  startedAt: null,
};

function modeMinutes(mode) {
  return mode === 'focus' ? state.settings.focus
       : mode === 'short' ? state.settings.short
       : state.settings.long;
}
function modeLabel(mode) {
  return mode === 'focus' ? 'Focus' : mode === 'short' ? 'Pause courte' : 'Pause longue';
}
function modeHint(mode) {
  const m = modeMinutes(mode);
  return mode === 'focus'
    ? `Restez concentré pendant ${m} min`
    : `Détendez-vous pendant ${m} min`;
}

function setMode(mode, opts = { resetTimer: true }) {
  timer.mode = mode;
  timer.durationSec = modeMinutes(mode) * 60;
  if (opts.resetTimer) timer.remainingSec = timer.durationSec;
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  timerHintEl.textContent = modeHint(mode);
  renderTimer();
}

function renderTimer() {
  const total = timer.durationSec;
  const remaining = timer.remainingSec;
  const elapsed = total - remaining;
  const pct = total === 0 ? 0 : elapsed / total;

  const offset = RING_CIRC * (1 - pct);
  ringFg.setAttribute('stroke-dashoffset', offset);

  // knob position along the ring
  const angle = pct * 360;
  ringKnob.setAttribute('transform', `rotate(${angle} 110 110)`);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  timerValueEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  timerLabelEl.textContent = timer.running ? 'En cours…' : (remaining === total ? 'Démarrer' : 'En pause');
  btnPlay.classList.toggle('playing', timer.running);
  btnPlay.setAttribute('aria-label', timer.running ? 'Pause' : 'Démarrer');
}

function startTimer() {
  if (timer.running) return;
  timer.running = true;
  timer.startedAt = Date.now();
  timer.intervalId = setInterval(tick, 1000);
  renderTimer();
}
function pauseTimer() {
  timer.running = false;
  clearInterval(timer.intervalId);
  timer.intervalId = null;
  renderTimer();
}
function resetTimer() {
  pauseTimer();
  timer.remainingSec = timer.durationSec;
  renderTimer();
}
function tick() {
  timer.remainingSec = Math.max(0, timer.remainingSec - 1);
  renderTimer();
  if (timer.remainingSec === 0) finishSession();
}
function finishSession() {
  pauseTimer();
  // record
  const task = state.tasks.find(t => t.id === state.activeTaskId);
  state.sessions.push({
    id: crypto.randomUUID(),
    mode: timer.mode,
    durationSec: timer.durationSec,
    finishedAt: Date.now(),
    taskId: task?.id || null,
    taskTitle: task?.title || null,
  });
  if (timer.mode === 'focus' && task) {
    task.completedSessions = Math.min((task.completedSessions || 0) + 1, task.totalSessions);
    if (task.completedSessions >= task.totalSessions) task.done = true;
  }
  save();

  if (state.settings.sound) try { dingSound.currentTime = 0; dingSound.play(); } catch {}
  if (state.settings.vibrate && 'vibrate' in navigator) navigator.vibrate([180, 80, 180]);
  flashScreen();

  // auto-cycle: focus -> short, after 4 focus -> long
  const focusCount = state.sessions.filter(s => s.mode === 'focus' && sameDay(s.finishedAt, Date.now())).length;
  if (timer.mode === 'focus') {
    setMode(focusCount % 4 === 0 ? 'long' : 'short');
  } else {
    setMode('focus');
  }
  renderHomeCurrent();
}
function flashScreen() {
  document.body.animate(
    [{ filter: 'brightness(1)' }, { filter: 'brightness(1.18)' }, { filter: 'brightness(1)' }],
    { duration: 600 }
  );
}

btnPlay.addEventListener('click', () => timer.running ? pauseTimer() : startTimer());
btnReset.addEventListener('click', resetTimer);
btnSkip.addEventListener('click', () => {
  // skip current session — count it only if more than 30s elapsed in focus mode
  if (timer.mode === 'focus' && (timer.durationSec - timer.remainingSec) > 30) {
    timer.remainingSec = 0;
    finishSession();
  } else {
    pauseTimer();
    // jump to next mode without recording
    setMode(timer.mode === 'focus' ? 'short' : 'focus');
  }
});
modeBtns.forEach(b => b.addEventListener('click', () => {
  if (timer.running) return; // don't switch while running
  setMode(b.dataset.mode);
}));

/* ============================== TASKS ============================== */
const taskList = document.getElementById('taskList');
const doneList = document.getElementById('doneList');
const todoCountEl = document.getElementById('todoCount');
const doneCountEl = document.getElementById('doneCount');
const emptyState = document.getElementById('emptyState');
const addForm = document.getElementById('addTaskForm');

addForm.addEventListener('submit', e => {
  e.preventDefault();
  const title = document.getElementById('taskInput').value.trim();
  if (!title) return;
  const sessions = clamp(parseInt(document.getElementById('taskSessions').value, 10) || 1, 1, 20);
  const duration = clamp(parseInt(document.getElementById('taskDuration').value, 10) || 25, 5, 90);
  state.tasks.unshift({
    id: crypto.randomUUID(),
    title,
    totalSessions: sessions,
    completedSessions: 0,
    sessionMinutes: duration,
    done: false,
    createdAt: Date.now(),
  });
  if (!state.activeTaskId) state.activeTaskId = state.tasks[0].id;
  save();
  document.getElementById('taskInput').value = '';
  renderTasks();
  renderHomeCurrent();
});

document.getElementById('clearDone').addEventListener('click', () => {
  state.tasks = state.tasks.filter(t => !t.done);
  save();
  renderTasks();
  renderHomeCurrent();
});

function renderTasks() {
  const todo = state.tasks.filter(t => !t.done);
  const done = state.tasks.filter(t => t.done);

  todoCountEl.textContent = todo.length;
  doneCountEl.textContent = done.length;
  emptyState.classList.toggle('show', state.tasks.length === 0);

  taskList.innerHTML = todo.map(taskRow).join('');
  doneList.innerHTML = done.map(taskRow).join('');

  taskList.querySelectorAll('.task-item').forEach(bind);
  doneList.querySelectorAll('.task-item').forEach(bind);
}

function taskRow(t) {
  const active = t.id === state.activeTaskId ? 'active' : '';
  const checked = t.done ? 'checked' : '';
  return `
    <li class="task-item ${t.done ? 'done' : ''} ${active}" data-id="${t.id}">
      <button class="task-check ${checked}" aria-label="Cocher">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>
      </button>
      <div>
        <div class="task-item__title">${escape(t.title)}</div>
        <div class="task-item__meta">${t.totalSessions * t.sessionMinutes} min · ${t.sessionMinutes} min/session</div>
      </div>
      <span class="task-item__sessions">${t.completedSessions}/${t.totalSessions}</span>
      <button class="task-del" aria-label="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
      </button>
    </li>`;
}

function bind(li) {
  const id = li.dataset.id;
  li.querySelector('.task-check').addEventListener('click', () => toggleTask(id));
  li.querySelector('.task-del').addEventListener('click', () => deleteTask(id));
  li.addEventListener('click', e => {
    if (e.target.closest('.task-check') || e.target.closest('.task-del')) return;
    selectTask(id);
  });
}

function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done && state.activeTaskId === id) {
    const next = state.tasks.find(x => !x.done);
    state.activeTaskId = next ? next.id : null;
  }
  save(); renderTasks(); renderHomeCurrent();
}
function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (state.activeTaskId === id) {
    const next = state.tasks.find(t => !t.done);
    state.activeTaskId = next ? next.id : null;
  }
  save(); renderTasks(); renderHomeCurrent();
}
function selectTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  state.activeTaskId = id;
  save();
  renderTasks();
  renderHomeCurrent();
  navigate('home');
}

/* ============================== HOME CURRENT TASK ============================== */
function renderHomeCurrent() {
  const t = state.tasks.find(x => x.id === state.activeTaskId && !x.done)
         || state.tasks.find(x => !x.done);
  const card = document.getElementById('currentTaskCard');
  if (!t) {
    document.getElementById('currentTaskTitle').textContent = 'Aucune tâche active';
    document.getElementById('currentTaskMinutes').textContent = '0';
    document.getElementById('currentTaskDone').textContent = '0';
    document.getElementById('currentTaskTotal').textContent = '0';
    document.getElementById('currentTaskSession').textContent = state.settings.focus;
    card.style.opacity = 0.7;
    return;
  }
  card.style.opacity = 1;
  document.getElementById('currentTaskTitle').textContent = t.title;
  document.getElementById('currentTaskMinutes').textContent = t.totalSessions * t.sessionMinutes;
  document.getElementById('currentTaskDone').textContent = t.completedSessions;
  document.getElementById('currentTaskTotal').textContent = t.totalSessions;
  document.getElementById('currentTaskSession').textContent = t.sessionMinutes;
  state.activeTaskId = t.id;
}
document.getElementById('currentTaskCard').addEventListener('click', () => navigate('tasks'));

/* ============================== STATS ============================== */
function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth() === db.getMonth() &&
         da.getDate() === db.getDate();
}
function startOfDay(ts) {
  const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime();
}

function renderStats() {
  const now = Date.now();
  const todayFocus = state.sessions
    .filter(s => s.mode === 'focus' && sameDay(s.finishedAt, now))
    .reduce((sum, s) => sum + s.durationSec, 0);
  const todayBreak = state.sessions
    .filter(s => s.mode !== 'focus' && sameDay(s.finishedAt, now))
    .reduce((sum, s) => sum + s.durationSec, 0);

  document.getElementById('todayFocusH').textContent = Math.floor(todayFocus / 3600);
  document.getElementById('todayFocusM').textContent = Math.floor((todayFocus % 3600) / 60);
  document.getElementById('todayBreakH').textContent = Math.floor(todayBreak / 3600);
  document.getElementById('todayBreakM').textContent = Math.floor((todayBreak % 3600) / 60);

  // 7-day chart
  const days = [];
  const labels = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const dayStart = d.getTime();
    const dayEnd = dayStart + 86400000;
    const total = state.sessions
      .filter(s => s.mode === 'focus' && s.finishedAt >= dayStart && s.finishedAt < dayEnd)
      .reduce((sum, s) => sum + s.durationSec, 0);
    days.push({ label: labels[d.getDay()], hours: total / 3600, isToday: i === 0 });
  }
  const max = Math.max(6, ...days.map(d => d.hours)); // axis max
  const bars = document.getElementById('chartBars');
  bars.innerHTML = days.map(d => {
    const h = Math.max(2, (d.hours / max) * 100);
    return `<div class="chart-bar ${d.isToday ? 'today' : ''}" style="height:${h}%"></div>`;
  }).join('');
  document.getElementById('chartLabels').innerHTML = days.map(d => `<span>${d.label}</span>`).join('');

  // recent sessions
  const recent = [...state.sessions].slice(-8).reverse();
  const card = document.getElementById('recentCard');
  if (recent.length === 0) {
    card.innerHTML = `<div class="empty empty--inline show"><p>Aucune session terminée. Lancez le timer pour commencer !</p></div>`;
  } else {
    card.innerHTML = recent.map(s => {
      const m = Math.round(s.durationSec / 60);
      const time = new Date(s.finishedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const date = sameDay(s.finishedAt, Date.now()) ? "Aujourd'hui" : new Date(s.finishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const label = s.mode === 'focus' ? (s.taskTitle || 'Session de focus') : (s.mode === 'short' ? 'Pause courte' : 'Pause longue');
      return `
        <div class="recent-item">
          <div>
            <div class="recent-item__title">${escape(label)}</div>
            <div class="recent-item__meta">${date} · ${time}</div>
          </div>
          <div class="recent-item__dur">${m} min</div>
        </div>`;
    }).join('');
  }
}

/* ============================== PROFILE ============================== */
function renderProfile() {
  const focusSecs = state.sessions.filter(s => s.mode === 'focus').reduce((s, x) => s + x.durationSec, 0);
  document.getElementById('totalSessionsStat').textContent = state.sessions.filter(s => s.mode === 'focus').length;
  document.getElementById('totalFocusStat').textContent = `${Math.floor(focusSecs / 3600)}h${String(Math.floor((focusSecs % 3600) / 60)).padStart(2,'0')}`;
  document.getElementById('streakStat').textContent = computeStreak();

  document.getElementById('setFocus').value = state.settings.focus;
  document.getElementById('setShort').value = state.settings.short;
  document.getElementById('setLong').value = state.settings.long;
  document.getElementById('setSound').checked = state.settings.sound;
  document.getElementById('setVibrate').checked = state.settings.vibrate;
}
function computeStreak() {
  let streak = 0;
  const day = 86400000;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    const start = d.getTime();
    const had = state.sessions.some(s => s.mode === 'focus' && s.finishedAt >= start && s.finishedAt < start + day);
    if (had) streak++;
    else if (i === 0) continue; // today not started yet — keep yesterday's streak alive
    else break;
  }
  return streak;
}

['setFocus','setShort','setLong'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => {
    const key = id.replace('set','').toLowerCase();
    const v = clamp(parseInt(e.target.value, 10) || 1, 1, 90);
    state.settings[key] = v;
    e.target.value = v;
    save();
    if (!timer.running) {
      // refresh timer if mode matches
      timer.durationSec = modeMinutes(timer.mode) * 60;
      timer.remainingSec = timer.durationSec;
      renderTimer();
      timerHintEl.textContent = modeHint(timer.mode);
    }
  });
});
document.getElementById('setSound').addEventListener('change', e => { state.settings.sound = e.target.checked; save(); });
document.getElementById('setVibrate').addEventListener('change', e => { state.settings.vibrate = e.target.checked; save(); });
document.getElementById('resetAll').addEventListener('click', () => {
  if (!confirm('Réinitialiser toutes les données (tâches, sessions, paramètres) ?')) return;
  state = defaultStore();
  save();
  setMode('focus');
  renderTasks();
  renderHomeCurrent();
  renderProfile();
});

/* ============================== UTILS ============================== */
function escape(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ============================== INIT ============================== */
setMode('focus', { resetTimer: true });
renderTasks();
renderHomeCurrent();

// keyboard: space toggles play/pause when on home
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space' && document.querySelector('.screen.active').dataset.screen === 'home') {
    e.preventDefault();
    timer.running ? pauseTimer() : startTimer();
  }
});
