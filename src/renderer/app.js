'use strict';
/* global Timeline */
const T = window.Timeline;
const api = window.minutes;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const SVGNS = 'http://www.w3.org/2000/svg';

const MIN_REASON = 15;         // characters required to justify a prune/extension
const GRACE_MS = 5 * 60 * 1000; // freshly added tasks can be removed without paperwork
const MOODS = T.STAGES.map((s) => s.mood);

let state = null;
let env = {};
const ui = { panelOpen: false, view: 'timeline', lastStage: null, forcedMood: null, lastSpoke: 0, preset: '+1h', hover: false };

// ---------------------------------------------------------------- lines
const LINES = {
  welcome: ["Well hi there! I'm Ms. Minutes. Click me to log your first assignment for the Sacred Timeline!"],
  happy: [
    "Everything's right on schedule, hon!",
    'The Sacred Timeline is looking mighty tidy today.',
    'Plenty of time on "{task}". Don\'t waste it, now!',
    'For all time. Always. ...and also by your deadline.',
  ],
  skeptical: [
    'Half the time on "{task}" is gone... you ARE working on it, right?',
    'Hmm. I\'ve got my eye on "{task}", sugar.',
    "Tick, tock. Just sayin'.",
  ],
  annoyed: [
    'Tick tock! "{task}" isn\'t going to finish itself.',
    "I'm not mad. I'm just... keeping very close track of time.",
    'Three-quarters of your time on "{task}" is gone, hon.',
  ],
  angry: [
    '"{task}" is due {when}! The timeline is branching!',
    'Sweetie, I have a reset charge and I am NOT afraid to use it.',
    'Drop everything. "{task}". Now.',
  ],
  furious: [
    'VARIANT DETECTED! "{task}" is overdue!',
    "That's a Nexus event, and you know what happens to those.",
    'Overdue! The Time-Keepers will be hearing about "{task}".',
  ],
  proud: [
    'Look at you! Every assignment done. The Time-Keepers would be proud.',
    'A pristine timeline! I could just tick with joy.',
    "All clear! Now that's what I call temporal integrity.",
  ],
  empty: ['No assignments on the timeline. Click me to log one!', 'Nothing logged? Even Variants need a to-do list.'],
  added: ['Logged! "{task}" is due {when}.', 'Assignment filed. I\'ll be watching the clock on "{task}".', 'Got it, hon. "{task}", {when}. No funny business.'],
  complete: ['"{task}" complete! Right on time, sugar.', 'Stamped and filed! Nice work.', "That's how we keep the timeline tidy!"],
  completeLate: ['"{task}" is done... late. I\'ll note it in your file.', 'Better late than pruned, I suppose.'],
  pruned: ['Pruned. I hope that reason was a good one.', "And just like that, it's gone. Noted in your file."],
  grace: ['Typo? No worries, hon. Removed.'],
  postponed: ["Extension granted. Don't make me regret it.", 'Fine. New deadline: {when}. This goes on your permanent record.'],
  morning: ['Good morning! Click me for your daily briefing.'],
  evening: ["Evening review time! Click me and let's see how today's timeline held up."],
  reviewBad: ["Some of today's assignments slipped. Tomorrow's a fresh timeline, hon."],
  reviewGood: ['A clean day on the Sacred Timeline. Well done, Variant!'],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const short = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
function lineFor(kind, task) {
  const now = Date.now();
  return fill(pick(LINES[kind]), task ? { task: short(task.title), when: T.formatDue(task.dueAt, now) } : {});
}

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const save = () => api.saveState(state);

const PRESETS = {
  '+30m': '+30 MIN', '+1h': '+1 HR', '+2h': '+2 HRS', '+3h': '+3 HRS',
  '5pm': '5 PM', '9pm': '9 PM', tmr9: 'TMRW 9 AM',
};
/** `rel` is the base for relative presets (e.g. the current deadline when extending). */
function presetTime(key, now = Date.now(), rel = now) {
  const at = (hr, addDays = 0) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(hr, 0, 0, 0); return d.getTime(); };
  const roundMin = (ms) => Math.ceil(ms / 60000) * 60000;
  switch (key) {
    case '+30m': return roundMin(rel + 30 * 60e3);
    case '+1h': return roundMin(rel + 60 * 60e3);
    case '+2h': return roundMin(rel + 120 * 60e3);
    case '+3h': return roundMin(rel + 180 * 60e3);
    case '5pm': return at(17) > now + 60e3 ? at(17) : at(17, 1);
    case '9pm': return at(21) > now + 60e3 ? at(21) : at(21, 1);
    case 'tmr9': return at(9, 1);
    default: return null;
  }
}

// ---------------------------------------------------------------- Ms. Minutes
const wrap = $('#minutes-wrap');
const svg = $('#minutes');

function buildFace() {
  const ticks = $('#ticks');
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    const major = i % 3 === 0;
    const r1 = major ? 55 : 59;
    const r2 = 66;
    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('x1', (100 + Math.sin(a) * r1).toFixed(1));
    line.setAttribute('y1', (98 - Math.cos(a) * r1).toFixed(1));
    line.setAttribute('x2', (100 + Math.sin(a) * r2).toFixed(1));
    line.setAttribute('y2', (98 - Math.cos(a) * r2).toFixed(1));
    line.setAttribute('stroke-width', major ? 4.5 : 3);
    ticks.append(line);
  }
  updateHands();
}
function updateHands() {
  const d = new Date();
  const m = d.getMinutes() + d.getSeconds() / 60;
  const hr = (d.getHours() % 12) + m / 60;
  $('#hand-m').setAttribute('transform', `rotate(${(m * 6).toFixed(1)} 100 98)`);
  $('#hand-h').setAttribute('transform', `rotate(${(hr * 30).toFixed(1)} 100 98)`);
}

function setMood(mood) {
  if (wrap.dataset.mood !== mood) wrap.dataset.mood = mood;
}
function computeMood(now) {
  if (ui.forcedMood) return ui.forcedMood;
  const stage = T.overallStage(state.tasks, now);
  if (stage >= 0) return MOODS[stage];
  return doneToday(now).length ? 'proud' : 'happy';
}
function wave() {
  wrap.classList.remove('waving');
  void wrap.offsetWidth;
  wrap.classList.add('waving');
  setTimeout(() => wrap.classList.remove('waving'), 1900);
}

// Pupils follow the cursor while it's over her window.
let lookTimer;
function lookAt(x, y) {
  const r = svg.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height * 0.33);
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, d / 110);
  wrap.style.setProperty('--px', `${((dx / d) * 4 * k).toFixed(2)}px`);
  wrap.style.setProperty('--py', `${((dy / d) * 5 * k).toFixed(2)}px`);
  clearTimeout(lookTimer);
  lookTimer = setTimeout(() => { wrap.style.removeProperty('--px'); wrap.style.removeProperty('--py'); }, 2500);
}

// ---------------------------------------------------------------- bubble
const bubble = $('#bubble');
let bubbleTimer;
let bubbleAction = null;
function say(text, { duration = 6500, alarm = false, sticky = false, onClick = null } = {}) {
  $('#bubble-text').textContent = text;
  bubble.classList.toggle('alarm', alarm);
  bubble.hidden = false;
  bubble.classList.remove('pop');
  void bubble.offsetWidth;
  bubble.classList.add('pop');
  bubbleAction = onClick;
  ui.lastSpoke = Date.now();
  clearTimeout(bubbleTimer);
  if (!sticky) bubbleTimer = setTimeout(hideBubble, duration);
}
function hideBubble() { bubble.hidden = true; bubbleAction = null; clearTimeout(bubbleTimer); }
bubble.addEventListener('click', () => { const a = bubbleAction; hideBubble(); if (a) a(); });

function statusLine() {
  const now = Date.now();
  const t = T.mostUrgent(state.tasks, now);
  if (!t) return doneToday(now).length ? pick(LINES.proud) : pick(LINES.empty);
  const n = T.activeTasks(state.tasks).length;
  return `"${short(t.title, 36)}": ${T.formatRemaining(t, now)}.${n > 1 ? ` (${n - 1} more on the timeline)` : ''}`;
}

// ---------------------------------------------------------------- click-through + drag
let ignoring = true;
let drag = null;
function setIgnore(v) { if (v !== ignoring) { ignoring = v; api.setIgnore(v); } }
document.addEventListener('mousemove', (e) => {
  if (!drag) setIgnore(!e.target.closest('.hit'));
  lookAt(e.clientX, e.clientY);
});
document.addEventListener('mouseleave', () => { if (!drag) setIgnore(true); });

wrap.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('#hide-btn')) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  api.dragStart();
});
let dragRaf = 0;
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.screenX - drag.x, e.screenY - drag.y) > 4) {
    drag.moved = true;
    wrap.classList.add('dragging');
  }
  if (drag.moved && !dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; api.dragMove(); });
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  wrap.classList.remove('dragging');
  api.dragEnd();
  if (!wasDrag) onMinutesClick();
});

let hoverTimer;
wrap.addEventListener('mouseenter', () => {
  ui.hover = true;
  if (wrap.dataset.mood === 'happy' || wrap.dataset.mood === 'proud') wave();
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if (ui.hover && !ui.panelOpen && bubble.hidden && !drag) say(statusLine(), { duration: 4000, alarm: T.overallStage(state.tasks, Date.now()) >= 3 });
  }, 650);
});
wrap.addEventListener('mouseleave', () => { ui.hover = false; clearTimeout(hoverTimer); });

$('#hide-btn').addEventListener('click', (e) => { e.stopPropagation(); closePanel(); api.hide(); });

function onMinutesClick() {
  svg.classList.remove('squash');
  void svg.getBoundingClientRect();
  svg.classList.add('squash');
  if (ui.panelOpen) closePanel();
  else openPanel();
}

// ---------------------------------------------------------------- panel
const panel = $('#panel');
function openPanel(view) {
  if (view) switchView(view);
  hideBubble();
  if (!ui.panelOpen) {
    ui.panelOpen = true;
    panel.hidden = false;
    panel.classList.remove('closing');
  }
  api.focus();
  renderAll();
  if (ui.view === 'timeline' && $('#modal').hidden) setTimeout(() => $('#add-title').focus(), 80);
}
function closePanel() {
  if (!ui.panelOpen) return;
  ui.panelOpen = false;
  closeModal();
  panel.classList.add('closing');
  setTimeout(() => { if (!ui.panelOpen) { panel.hidden = true; panel.classList.remove('closing'); } }, 170);
}
$('#panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal();
  else closePanel();
});
function switchView(view) {
  ui.view = view;
  for (const v of ['timeline', 'records', 'settings']) $(`#view-${v}`).hidden = v !== view;
  $$('.key').forEach((k) => k.classList.toggle('active', k.dataset.view === view));
  $('#screen-inner').scrollTop = 0;
  if (view === 'records') renderRecords();
  if (view === 'settings') renderSettings();
}
$$('.key').forEach((k) => k.addEventListener('click', () => switchView(k.dataset.view)));

function updateClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  updateHands();
}

// ---------------------------------------------------------------- tasks
const doneToday = (now) => state.tasks.filter((t) => t.status === 'done' && T.dayKey(t.completedAt) === T.dayKey(now));
function findTask(id) { return state.tasks.find((t) => t.id === id); }

function renderChips(container, keys, onPick, activeKey) {
  container.textContent = '';
  for (const k of keys) {
    container.append(h('button', { type: 'button', class: 'chip' + (k === activeKey ? ' on' : ''), 'data-k': k, text: PRESETS[k], onclick: () => {
      $$('.chip', container).forEach((c) => c.classList.toggle('on', c.dataset.k === k));
      onPick(k);
    } }));
  }
}
function resetAddForm() {
  ui.preset = '+1h';
  $('#add-due').value = toLocalInput(presetTime('+1h'));
  renderChips($('#due-chips'), ['+30m', '+1h', '+2h', '5pm', '9pm', 'tmr9'], (k) => {
    ui.preset = k;
    $('#add-due').value = toLocalInput(presetTime(k));
  }, '+1h');
}
$('#add-due').addEventListener('input', () => { ui.preset = null; $$('#due-chips .chip').forEach((c) => c.classList.remove('on')); });

function addError(msg) {
  const el = $('#add-error');
  el.textContent = msg;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const now = Date.now();
  const title = $('#add-title').value.trim();
  if (!title) { addError('Every assignment needs a name, hon.'); $('#add-title').focus(); return; }
  // Re-resolve a relative preset at submit time so "+1 hr" means an hour from now.
  const due = ui.preset ? presetTime(ui.preset, now) : fromLocalInput($('#add-due').value);
  if (!due || due <= now + 60e3) { addError("That deadline's already passed. That's how Nexus events happen."); return; }
  const task = { id: uid(), title, createdAt: now, dueAt: due, status: 'active', postponements: [] };
  state.tasks.push(task);
  save();
  $('#add-title').value = '';
  $('#add-error').textContent = '';
  resetAddForm();
  renderTasks();
  say(lineFor('added', task), { duration: 4500 });
  wave();
  tick();
});

function stageClass(st) { return `task s${Math.max(0, st)}`; }

function taskCard(t, now) {
  const st = T.stageOf(t, now);
  const ext = t.postponements.length;
  return h('article', { class: stageClass(st), 'data-id': t.id },
    h('div', { class: 'task-top' },
      h('span', { class: 'task-title', text: t.title }),
      h('span', { class: 'badges' },
        ext ? h('span', { class: 'badge ext', title: `Extended ${ext}×`, text: `EXT×${ext}` }) : null,
        h('span', { class: 'badge', text: T.STAGES[st].label }))),
    h('div', { class: 'meter', title: 'Share of the time window used' },
      h('div', { class: 'fill', style: `width:${Math.min(100, T.progress(t, now) * 100).toFixed(1)}%` }),
      h('span', { class: 'mark', style: 'left:50%' }), h('span', { class: 'mark', style: 'left:75%' }), h('span', { class: 'mark', style: 'left:90%' })),
    h('div', { class: 'task-meta' },
      h('span', { class: 'due', text: 'Due ' + T.formatDue(t.dueAt, now) }),
      h('span', { class: 'left', text: T.formatRemaining(t, now) })),
    h('div', { class: 'task-actions' },
      h('button', { type: 'button', 'data-act': 'done', text: '✓ Done' }),
      h('button', { type: 'button', 'data-act': 'postpone', text: 'Extend' }),
      h('button', { type: 'button', 'data-act': 'prune', text: 'Prune' })),
    h('div', { class: 'stamp' }));
}

function renderTasks() {
  const now = Date.now();
  const list = $('#task-list');
  list.textContent = '';
  const active = T.activeTasks(state.tasks).sort((a, b) => a.dueAt - b.dueAt);
  if (!active.length) {
    list.append(h('div', { class: 'empty' },
      h('div', { class: 'big', text: doneToday(now).length ? 'TIMELINE PRISTINE' : 'THE SACRED TIMELINE IS CLEAR' }),
      h('div', { class: 'small', text: doneToday(now).length ? 'Every assignment is complete. Log another, or take a breather.' : 'Log an assignment above and I\'ll keep the time.' })));
  }
  for (const t of active) list.append(taskCard(t, now));

  const done = doneToday(now).sort((a, b) => b.completedAt - a.completedAt);
  $('#done-count').textContent = done.length;
  $('#done-today').hidden = !done.length;
  const dl = $('#done-list');
  dl.textContent = '';
  for (const t of done) {
    const onTime = t.completedAt <= t.dueAt;
    dl.append(h('div', { class: 'done-item' },
      h('span', { class: 't', text: t.title }),
      h('span', { class: 'tag ' + (onTime ? 'ok' : 'late'), text: (onTime ? 'ON TIME · ' : 'LATE · ') + T.formatTime(t.completedAt) })));
  }
  refreshLive(now);
}

/** Cheap per-tick update of meters and countdowns without rebuilding the DOM. */
function refreshLive(now) {
  for (const card of $$('#task-list .task')) {
    const t = findTask(card.dataset.id);
    if (!t || t.status !== 'active' || card.classList.contains('completing') || card.classList.contains('pruning')) continue;
    const st = T.stageOf(t, now);
    card.className = stageClass(st);
    $('.fill', card).style.width = `${Math.min(100, T.progress(t, now) * 100).toFixed(1)}%`;
    $('.left', card).textContent = T.formatRemaining(t, now);
    $('.badge:not(.ext)', card).textContent = T.STAGES[st].label;
  }
  const stage = T.overallStage(state.tasks, now);
  const label = stage >= 0 ? T.STAGES[stage].label : (doneToday(now).length ? 'PRISTINE' : 'CLEAR');
  const color = `var(--s${Math.max(0, stage)})`;
  $('#tl-status').textContent = label;
  $('#view-timeline').style.setProperty('--status-color', color);
  $('#tl-count').textContent = `${T.activeTasks(state.tasks).length} ACTIVE`;
  const led = $('#status-led');
  led.style.setProperty('--led', color);
  led.classList.toggle('blink', stage >= 3);
}

function collapseCard(card, after) {
  card.style.maxHeight = card.scrollHeight + 'px';
  requestAnimationFrame(() => {
    card.classList.add('collapse');
    card.style.maxHeight = '0px';
  });
  setTimeout(after, 380);
}

$('#task-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.task');
  const t = findTask(card.dataset.id);
  if (!t) return;
  const act = btn.dataset.act;
  if (act === 'done') completeTask(t, card);
  else if (act === 'postpone') openPostponeModal(t);
  else if (act === 'prune') {
    const now = Date.now();
    if (now - t.createdAt < GRACE_MS && now < t.dueAt) doPrune(t, 'Removed during the 5-minute grace window', true);
    else openPruneModal(t);
  }
});

function completeTask(t, card) {
  const now = Date.now();
  t.status = 'done';
  t.completedAt = now;
  save();
  const onTime = now <= t.dueAt;
  if (card) {
    $('.stamp', card).textContent = onTime ? 'COMPLETE' : 'LATE';
    card.classList.add('completing');
    setTimeout(() => collapseCard(card, renderAll), 750);
  } else renderAll();
  if (!T.activeTasks(state.tasks).length) say(lineFor('proud'), { duration: 6000 });
  else say(lineFor(onTime ? 'complete' : 'completeLate', t), { duration: 4500 });
  tick();
}

function doPrune(t, reason, grace = false) {
  const now = Date.now();
  t.status = 'pruned';
  t.prunedAt = now;
  t.prunedReason = reason;
  t.prunedWhileOverdue = now > t.dueAt;
  if (grace) t.grace = true;
  save();
  closeModal();
  const card = $(`#task-list .task[data-id="${CSS.escape(t.id)}"]`);
  if (card) {
    $('.stamp', card).textContent = 'PRUNED';
    card.classList.add('pruning');
    setTimeout(() => collapseCard(card, renderAll), 950);
  } else renderAll();
  say(lineFor(grace ? 'grace' : 'pruned', t), { duration: 4500 });
  tick();
}

// ---------------------------------------------------------------- modals
function closeModal() {
  const m = $('#modal');
  m.hidden = true;
  m.textContent = '';
}
function showModal(form) {
  const m = $('#modal');
  m.textContent = '';
  m.append(form);
  m.hidden = false;
  const ta = $('textarea', form);
  if (ta) setTimeout(() => ta.focus(), 50);
}
function reasonField(onInput) {
  const ta = h('textarea', { maxlength: 280, placeholder: 'Explain yourself, Variant…', spellcheck: 'false' });
  const counter = h('div', { class: 'counter' });
  const update = () => {
    const n = ta.value.trim().length;
    counter.textContent = n >= MIN_REASON ? '✓ JUSTIFICATION ACCEPTED' : `${MIN_REASON - n} MORE CHARACTERS REQUIRED`;
    counter.classList.toggle('ok', n >= MIN_REASON);
    onInput();
  };
  ta.addEventListener('input', update);
  return { ta, counter, update, valid: () => ta.value.trim().length >= MIN_REASON };
}

function openPostponeModal(t) {
  const now = Date.now();
  const overdue = now > t.dueAt;
  const rel = Math.max(now, t.dueAt);
  const input = h('input', { type: 'datetime-local', value: toLocalInput(presetTime('+1h', now, rel)) });
  const submit = h('button', { type: 'button', class: 'btn-primary', disabled: true, text: 'Submit to the Time-Keepers' });
  const chips = h('div', { class: 'chips' });
  const validate = () => {
    const due = fromLocalInput(input.value);
    submit.disabled = !(reason.valid() && due && due > Date.now() + 60e3 && due !== t.dueAt);
  };
  const reason = reasonField(validate);
  renderChips(chips, ['+1h', '+3h', '9pm', 'tmr9'], (k) => { input.value = toLocalInput(presetTime(k, Date.now(), Math.max(Date.now(), t.dueAt))); validate(); }, '+1h');
  input.addEventListener('input', () => { $$('.chip', chips).forEach((c) => c.classList.remove('on')); validate(); });
  submit.addEventListener('click', () => {
    const due = fromLocalInput(input.value);
    const at = Date.now();
    t.postponements.push({ at, fromDue: t.dueAt, toDue: due, reason: reason.ta.value.trim(), wasOverdue: at > t.dueAt });
    t.dueAt = due;
    save();
    closeModal();
    renderAll();
    say(lineFor('postponed', t), { duration: 5000 });
    tick();
  });
  reason.update();
  showModal(h('div', { class: 'form' },
    h('div', { class: 'form-no', text: 'FORM TVA-77B' }),
    h('h3', { text: 'Timeline extension request' }),
    h('div', { class: 'subject', text: `"${t.title}" · currently due ${T.formatDue(t.dueAt, now)}` }),
    h('label', { text: 'NEW DEADLINE' }), chips, input,
    h('label', { text: `JUSTIFICATION (${MIN_REASON}+ CHARACTERS)` }), reason.ta, reason.counter,
    overdue
      ? h('div', { class: 'warn', text: 'This assignment is already overdue. Extending it now counts as a missed deadline in your record.' })
      : h('div', { class: 'note', text: `Extensions so far: ${t.postponements.length}. Every extension and its excuse goes on your permanent record.` }),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Cancel', onclick: closeModal }), submit)));
}

function openPruneModal(t) {
  const now = Date.now();
  const overdue = now > t.dueAt;
  const hold = h('button', { type: 'button', class: 'hold', disabled: true }, h('span', { class: 'bar' }), h('span', { text: 'Hold to prune' }));
  const reason = reasonField(() => { hold.disabled = !reason.valid(); });
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; hold.classList.remove('holding'); };
  hold.addEventListener('mousedown', () => {
    if (hold.disabled) return;
    hold.classList.add('holding');
    timer = setTimeout(() => { cancel(); doPrune(t, reason.ta.value.trim()); }, 1500);
  });
  hold.addEventListener('mouseup', cancel);
  hold.addEventListener('mouseleave', cancel);
  reason.update();
  showModal(h('div', { class: 'form' },
    h('div', { class: 'form-no', text: 'PRUNE ORDER · FORM TVA-00' }),
    h('h3', { text: 'Prune this branch?' }),
    h('div', { class: 'subject', text: `"${t.title}" will be erased from the Sacred Timeline.` }),
    h('label', { text: `REASON FOR PRUNING (${MIN_REASON}+ CHARACTERS)` }), reason.ta, reason.counter,
    overdue
      ? h('div', { class: 'warn', text: 'This assignment is overdue. Pruning it now counts as a missed deadline.' })
      : h('div', { class: 'note', text: 'Your reason is filed under "Excuses on file" in your Records.' }),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Cancel', onclick: closeModal }), hold)));
}

// ---------------------------------------------------------------- check-ins
function handleCheckin({ type, day }) {
  state.pendingCheckin = { type, day };
  save();
  wave();
  say(lineFor(type), { sticky: true, onClick: () => openPanel('timeline') });
  if (ui.panelOpen) renderBanner();
}
function renderBanner() {
  const b = $('#banner');
  b.textContent = '';
  const c = state.pendingCheckin;
  const now = Date.now();
  if (!c || c.day !== T.dayKey(now)) {
    if (c) { state.pendingCheckin = null; save(); }
    b.hidden = true;
    return;
  }
  const stats = T.computeStats(state.tasks, now);
  const active = T.activeTasks(state.tasks);
  const overdue = active.filter((t) => now > t.dueAt);
  const dateLabel = new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const dismiss = (msg) => h('button', { type: 'button', class: 'btn-primary', text: msg, onclick: () => {
    const wasEvening = c.type === 'evening';
    state.pendingCheckin = null;
    save();
    renderBanner();
    if (wasEvening) say(lineFor(stats.today.fail || overdue.length ? 'reviewBad' : 'reviewGood'), { duration: 5000 });
    else $('#add-title').focus();
  } });

  if (c.type === 'morning') {
    const carried = active.filter((t) => T.dayKey(t.createdAt) !== T.dayKey(now));
    b.append(
      h('h3', { text: `DAILY BRIEFING · ${dateLabel}` }),
      h('p', { text: carried.length
        ? `${carried.length} assignment${carried.length > 1 ? 's' : ''} carried over${overdue.length ? `, ${overdue.length} already overdue` : ''}.`
        : 'No assignments carried over. A fresh timeline!' }),
      h('p', { text: `Current streak: ${stats.streak} day${stats.streak === 1 ? '' : 's'}. Log what you'll finish today. Three solid assignments beat ten wishful ones.` }),
      h('div', { class: 'row' }, dismiss('Acknowledged')));
  } else {
    const t = stats.today;
    b.append(
      h('h3', { text: `EVENING REVIEW · ${dateLabel}` }),
      h('p', { text: `Today: ${t.ok} on time, ${t.fail} missed or late, ${active.length} still open.` }),
      h('p', { text: active.length
        ? 'Resolve each open assignment below: complete it, extend it with a reason, or prune it.'
        : 'Nothing left open. The timeline is tidy for the night.' }),
      h('div', { class: 'row' }, dismiss('File report')));
  }
  b.hidden = false;
}

// ---------------------------------------------------------------- records
function renderRecords() {
  const now = Date.now();
  const s = T.computeStats(state.tasks, now);
  $('#file-no').textContent = String(state.tasks.length).padStart(4, '0');
  const tiles = $('#tiles');
  tiles.textContent = '';
  const tile = (v, unit, k) => h('div', { class: 'tile' }, h('div', { class: 'v' }, String(v), unit ? h('small', { text: unit }) : null), h('div', { class: 'k', text: k }));
  tiles.append(
    tile(s.streak, s.streak === 1 ? 'day' : 'days', 'Current streak'),
    tile(s.bestStreak, s.bestStreak === 1 ? 'day' : 'days', 'Best streak'),
    tile(s.rate == null ? '—' : Math.round(s.rate * 100), s.rate == null ? '' : '%', 'On-time rate'),
    tile(s.completed, '', 'Completed'),
    tile(s.postponements, '', 'Extensions'),
    tile(s.pruned, '', 'Pruned'));

  const week = $('#week');
  const labels = $('#week-labels');
  week.textContent = '';
  labels.textContent = '';
  const max = Math.max(1, ...s.last7.map((d) => d.ok + d.fail));
  for (const d of s.last7) {
    week.append(h('div', { class: 'day', title: `${d.key}: ${d.ok} on time, ${d.fail} missed` },
      d.ok ? h('div', { class: 'ok', style: `height:${(d.ok / max) * 100}%` }) : null,
      d.fail ? h('div', { class: 'bad', style: `height:${(d.fail / max) * 100}%` }) : null));
    labels.append(h('div', { class: d.isToday ? 'today' : '', text: d.label }));
  }

  const entries = [];
  for (const t of state.tasks) {
    if (t.status === 'pruned' && !t.grace) entries.push({ at: t.prunedAt, kind: 'prune', title: t.title, reason: t.prunedReason });
    for (const p of t.postponements) entries.push({ at: p.at, kind: 'ext', title: t.title, reason: p.reason });
  }
  entries.sort((a, b) => b.at - a.at);
  const log = $('#log');
  log.textContent = '';
  if (!entries.length) log.append(h('li', { class: 'none', text: 'No excuses on file. Keep it that way.' }));
  for (const e of entries.slice(0, 15)) {
    log.append(h('li', {},
      h('span', { class: 'when', text: new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) }),
      h('span', { class: `kind ${e.kind}`, text: e.kind === 'prune' ? 'PRUNED' : 'EXTENDED' }),
      e.title,
      h('span', { class: 'reason', text: `"${e.reason}"` })));
  }
}

// ---------------------------------------------------------------- settings
function renderSettings() {
  const s = state.settings;
  $('#set-notifications').value = s.notifications;
  $('#set-quiet').checked = s.quietEnabled;
  $('#set-quiet-start').value = s.quietStart;
  $('#set-quiet-end').value = s.quietEnd;
  $('#set-checkins').checked = s.checkins;
  $('#set-morning').value = s.morningTime;
  $('#set-evening').value = s.eveningTime;
  $('#set-return').checked = s.returnWhenOverdue;
  $('#set-login').checked = s.launchAtLogin;
  $('#set-login').disabled = !env.isPackaged;
  $('#login-hint').textContent = !env.isPackaged ? 'Available once packaged as an app'
    : ui.loginProblem === 'approval' ? 'Approve it in System Settings → General → Login Items'
    : ui.loginProblem === 'failed' ? 'macOS blocked this. Add it via System Settings → General → Login Items'
    : 'Start Ms. Minutes when you log in';
  $('#set-quiet-start').closest('.setting').classList.toggle('disabled', !s.quietEnabled);
  $('#set-morning').closest('.setting').classList.toggle('disabled', !s.checkins);
}
function bindSettings() {
  const bind = (sel, key, prop = 'value') => $(sel).addEventListener('change', (e) => {
    const v = e.target[prop];
    if (prop === 'value' && e.target.type === 'time' && !v) { renderSettings(); return; }
    state.settings[key] = v;
    save();
    renderSettings();
  });
  bind('#set-notifications', 'notifications');
  bind('#set-quiet', 'quietEnabled', 'checked');
  bind('#set-quiet-start', 'quietStart');
  bind('#set-quiet-end', 'quietEnd');
  bind('#set-checkins', 'checkins', 'checked');
  bind('#set-morning', 'morningTime');
  bind('#set-evening', 'eveningTime');
  bind('#set-return', 'returnWhenOverdue', 'checked');
  bind('#set-login', 'launchAtLogin', 'checked');
  $('#btn-reset-pos').addEventListener('click', () => api.resetPosition());
  $('#btn-hide').addEventListener('click', () => { closePanel(); api.hide(); });
  $('#btn-quit').addEventListener('click', () => api.quit());
}

// ---------------------------------------------------------------- loop
function renderAll() {
  renderBanner();
  renderTasks();
  if (ui.view === 'records') renderRecords();
  if (ui.view === 'settings') renderSettings();
}

function tick() {
  const now = Date.now();
  setMood(computeMood(now));
  if (ui.panelOpen) refreshLive(now);
  // React when the most urgent task escalates.
  const stage = T.overallStage(state.tasks, now);
  if (ui.lastStage !== null && stage > ui.lastStage && stage >= 1 && !ui.forcedMood) {
    say(lineFor(MOODS[stage], T.mostUrgent(state.tasks, now)), { alarm: stage >= 3, duration: stage >= 3 ? 9000 : 6500 });
    if (ui.panelOpen) renderTasks();
  }
  ui.lastStage = stage;
}

function idleChatter() {
  const now = Date.now();
  if (ui.panelOpen || ui.hover || !bubble.hidden || now - ui.lastSpoke < 25 * 60e3) return;
  const t = T.mostUrgent(state.tasks, now);
  if (!t) return;
  say(lineFor(MOODS[T.stageOf(t, now)], t), { alarm: T.stageOf(t, now) >= 3 });
}

async function init() {
  const res = await api.getState();
  state = res.data;
  env = res.env || {};
  buildFace();
  bindSettings();
  resetAddForm();
  updateClock();
  setInterval(updateClock, 15e3);
  tick();
  setInterval(tick, 5e3);
  setInterval(idleChatter, 60e3);

  api.on('panel:open', () => openPanel());
  api.on('checkin', handleCheckin);
  api.on('settings:external', (s) => { state.settings = s; if (ui.view === 'settings') renderSettings(); });
  api.on('login:status', (problem) => { ui.loginProblem = problem; if (ui.view === 'settings') renderSettings(); });

  if (env.snapshot) installDebug();
  else if (!state.welcomed) {
    state.welcomed = true;
    save();
    setTimeout(() => { wave(); say(pick(LINES.welcome), { duration: 10000 }); }, 900);
  } else if (state.pendingCheckin && state.pendingCheckin.day === T.dayKey(Date.now())) {
    setTimeout(() => say(lineFor(state.pendingCheckin.type), { sticky: true, onClick: () => openPanel('timeline') }), 900);
  } else {
    setTimeout(() => say(statusLine(), { duration: 5000 }), 900);
  }
}

// Dev-only hooks used by the screenshot mode (MINUTES_SNAPSHOT).
function installDebug() {
  window.__debug = {
    mood(m) { ui.forcedMood = m; tick(); if (m) say(lineFor(m === 'proud' ? 'proud' : m, { title: 'Finish the history essay', dueAt: Date.now() + 9 * 60e3 }), { duration: 60000, alarm: m === 'angry' || m === 'furious' }); else hideBubble(); },
    seed() {
      const now = Date.now();
      const M = 60e3;
      const day = 864e5;
      const mk = (title, createdAgo, dueIn, extra = {}) => ({ id: uid(), title, createdAt: now - createdAgo, dueAt: now + dueIn, status: 'active', postponements: [], ...extra });
      state.tasks = [
        mk('Submit lab report', 200 * M, -15 * M),
        mk('Finish the history essay intro', 100 * M, 8 * M, { postponements: [{ at: now - 90 * M, fromDue: now - 60 * M, toDue: now + 8 * M, reason: 'Needed one more source for the thesis', wasOverdue: false }] }),
        mk('Email Professor Lee about office hours', 90 * M, 30 * M),
        mk('Gym: 30 minutes', 30 * M, 150 * M),
        { id: uid(), title: 'Read chapter 4', createdAt: now - 300 * M, dueAt: now - 20 * M, status: 'done', completedAt: now - 40 * M, postponements: [] },
        ...[1, 2, 3, 4].map((d) => ({ id: uid(), title: 'Daily review', createdAt: now - d * day - 60 * M, dueAt: now - d * day, status: 'done', completedAt: now - d * day - 10 * M, postponements: [] })),
        { id: uid(), title: 'Organize desk', createdAt: now - 5 * day, dueAt: now - 5 * day + 60 * M, status: 'pruned', prunedAt: now - 5 * day + 90 * M, prunedReason: 'Turned out the desk was already clean enough', prunedWhileOverdue: true, postponements: [] },
      ];
      ui.lastStage = T.overallStage(state.tasks, now);
      renderAll();
      tick();
    },
    open(view) { openPanel(view); },
    checkin(type) { state.pendingCheckin = { type, day: T.dayKey(Date.now()) }; renderBanner(); },
    dismissBanner() { state.pendingCheckin = null; renderBanner(); },
    modal(kind) {
      const t = T.activeTasks(state.tasks).sort((a, b) => a.dueAt - b.dueAt)[kind === 'prune' ? 1 : 0];
      if (kind === 'prune') openPruneModal(t); else openPostponeModal(t);
      const ta = $('#modal textarea');
      ta.value = kind === 'prune' ? 'The professor cancelled this assignment' : 'Printer';
      ta.dispatchEvent(new Event('input'));
    },
    closeModal,
  };
}

init();
