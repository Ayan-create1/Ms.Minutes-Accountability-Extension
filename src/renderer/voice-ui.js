'use strict';
/* Voice commands: the "Temporal Audio Link" screen inside the terminal.
 * Loaded after app.js and uses its helpers ($, h, state, say, openPanel, addTask, ...). */
/* global Voice, T, api, state, ui, $, $$, h, say, wave, openPanel, closePanel, switchView, closeModal,
          addTask, completeTask, openPostponeModal, toLocalInput, fromLocalInput, presetTime, short, pick */
window.VoiceUI = (() => {
  const P = window.Voice;
  const root = $('#voice');
  const micKey = $('#mic-key');
  const wrapEl = $('#minutes-wrap');

  const SILENCE_AFTER_SPEECH = 2000;
  const SILENCE_BEFORE_SPEECH = 8000;

  const vx = { state: 'idle', session: 0, text: '', levels: [], startedAt: 0, error: null, silence: null, raf: 0, fake: null };

  const EXAMPLES = [
    '“Finish the lab report, due tomorrow at 9pm”',
    '“Add read chapter 4 due Friday”',
    '“What’s due today?”',
    '“Mark the history essay done”',
    '“Extend the essay to Sunday because…”',
    '“Remind me to email Professor Lee in two hours”',
    '“Open records”',
  ];

  const SAY = {
    unclear: ['Sorry, hon, that transmission was all static.', "I didn't quite catch that, sugar. Try again?"],
    silent: ["I didn't hear a peep, hon.", 'Nothing came through on the audio link.'],
    cancel: ["Never mind? Alright, I'll be right here.", 'Transmission cancelled.'],
    records: ['Pulling up your permanent record, hon.', 'Here is your file. Every last excuse.'],
    settings: ['Configuration, coming right up.'],
    timeline: ['Here is your timeline, sugar.'],
    nothingToDo: ["There's nothing on the timeline to complete, sugar."],
    nothingToExtend: ["There's nothing on the timeline to extend, hon."],
  };

  // ------------------------------------------------------------ helpers
  const isOpen = () => !root.hidden;
  const isLive = () => ['starting', 'permission', 'listening', 'decoding'].includes(vx.state);

  function setListening(on) {
    micKey.classList.toggle('live', on);
    micKey.setAttribute('aria-pressed', on ? 'true' : 'false');
    wrapEl.classList.toggle('listening', on);
  }
  function show(...children) {
    if (!ui.panelOpen) openPanel();
    closeModal();
    root.textContent = '';
    root.append(...children);
    root.hidden = false;
  }
  function close() {
    clearTimeout(vx.silence);
    clearInterval(vx.fake);
    cancelAnimationFrame(vx.raf);
    vx.raf = 0;
    vx.state = 'idle';
    setListening(false);
    root.hidden = true;
    root.textContent = '';
  }
  const head = (left, right) => h('div', { class: 'vx-head' }, h('span', { text: left }), right || null);
  const actions = (...btns) => h('div', { class: 'form-actions' }, ...btns);
  const ghost = (text, onclick) => h('button', { type: 'button', class: 'btn-ghost', text, onclick });
  const primary = (text, onclick) => h('button', { type: 'button', class: 'btn-primary', text, onclick });
  const retryBtn = () => ghost('↺ Retry', () => listen());
  const closeBtn = (text = 'Close') => ghost(text, close);
  const appendAll = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));
  const heard = (text) => (text ? h('div', { class: 'vx-heard' }, h('span', { text: 'HEARD ' }), `“${text}”`) : null);

  // ------------------------------------------------------------ listening
  async function listen() {
    if (isLive()) { stopListening(); return; }
    close();
    vx.state = 'starting';
    vx.text = '';
    vx.levels = [];
    vx.error = null;
    renderListening();
    setListening(true);
    vx.session = await api.voiceStart();
  }

  function stopListening() {
    if (vx.state === 'starting' || vx.state === 'permission' || vx.state === 'listening') {
      vx.state = 'decoding';
      clearTimeout(vx.silence);
      api.voiceStop();
      setStatus('DECODING TRANSMISSION', true);
      const stopBtn = $('.vx-stop', root);
      if (stopBtn) stopBtn.disabled = true;
    }
  }

  function cancel(quiet = false) {
    if (!isOpen() && !isLive()) return;
    if (isLive()) api.voiceCancel();
    close();
    if (!quiet) say(pick(SAY.cancel), { duration: 3000 });
  }

  function armSilence(ms) {
    clearTimeout(vx.silence);
    vx.silence = setTimeout(stopListening, ms);
  }

  function renderListening() {
    const canvas = h('canvas', { class: 'scope-canvas' });
    const ex = pick(EXAMPLES);
    show(
      h('div', { class: 'vx' },
        head('TEMPORAL AUDIO LINK · CH-07', h('span', { class: 'vx-rec' }, h('i'), 'REC')),
        h('div', { class: 'scope' },
          canvas,
          h('span', { class: 'scope-label', text: 'INPUT · MIC-1' }),
          h('span', { class: 'scope-tc', id: 'vx-tc', text: 'T+00:00.0' })),
        h('div', { class: 'vx-status', id: 'vx-status' }, h('span', { class: 'txt', text: 'OPENING CHANNEL' }), h('span', { class: 'dots' })),
        h('div', { class: 'vx-transcript empty', id: 'vx-transcript' }, h('span', { class: 'words', text: 'Go ahead, hon. I’m listening.' }), h('span', { class: 'cursor', text: '▌' })),
        h('div', { class: 'vx-hint', text: `Try ${ex}` }),
        h('div', { class: 'vx-spacer' }),
        actions(
          ghost('Cancel', () => cancel()),
          h('button', { type: 'button', class: 'btn-primary vx-stop', onclick: stopListening }, h('span', { class: 'sq' }), 'Done talking'))));
    startScope(canvas);
  }

  function setStatus(text, busy = true) {
    const el = $('#vx-status');
    if (!el) return;
    $('.txt', el).textContent = text;
    el.classList.toggle('busy', busy);
  }
  function setTranscript(text) {
    const el = $('#vx-transcript');
    if (!el) return;
    el.classList.toggle('empty', !text);
    $('.words', el).textContent = text ? `“${text}”` : 'Go ahead, hon. I’m listening.';
  }

  // oscilloscope
  function startScope(canvas) {
    cancelAnimationFrame(vx.raf);
    const ctx = canvas.getContext('2d');
    let smooth = 0;
    const draw = (t) => {
      if (!canvas.isConnected) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const hgt = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      // grid
      ctx.strokeStyle = 'rgba(255,181,71,.10)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 10) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, hgt); ctx.stroke(); }
      for (let y = 0; y <= hgt; y += hgt / 4) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke(); }
      // signal
      const target = vx.levels.length ? vx.levels[vx.levels.length - 1] : 0;
      smooth += (target - smooth) * 0.25;
      const live = vx.state === 'listening';
      const amp = (live ? 0.06 + smooth * 0.9 : 0.03) * (hgt / 2 - 6);
      const mid = hgt / 2;
      const time = t / 1000;
      ctx.lineWidth = 2;
      ctx.strokeStyle = vx.state === 'decoding' ? 'rgba(255,181,71,.55)' : '#ffb547';
      ctx.shadowColor = 'rgba(255,170,60,.85)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const p = x / w;
        const env = Math.sin(Math.PI * p); // pinned at both ends like a scope trace
        const y = mid + env * amp * (Math.sin(p * 22 + time * 9) * 0.6 + Math.sin(p * 47 - time * 13) * 0.3 + Math.sin(p * 9 + time * 4) * 0.25);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // timecode
      const tc = $('#vx-tc');
      if (tc && vx.startedAt && live) {
        const s = (Date.now() - vx.startedAt) / 1000;
        tc.textContent = `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
      }
      vx.raf = requestAnimationFrame(draw);
    };
    vx.raf = requestAnimationFrame(draw);
  }

  // ------------------------------------------------------------ helper events
  api.on('voice:event', (ev) => {
    if (!ev || ev.session !== vx.session || vx.state === 'idle' || vx.state === 'done') return;
    switch (ev.type) {
      case 'permission':
        vx.state = 'permission';
        renderPermission(ev.what);
        break;
      case 'ready':
        if (vx.state === 'permission') renderListening();
        vx.state = 'listening';
        vx.startedAt = Date.now();
        setStatus('RECEIVING TRANSMISSION');
        armSilence(SILENCE_BEFORE_SPEECH);
        break;
      case 'level':
        vx.levels.push(ev.value);
        if (vx.levels.length > 60) vx.levels.shift();
        if (vx.state === 'listening' && vx.text && ev.value > 0.4) armSilence(SILENCE_AFTER_SPEECH); // still talking
        break;
      case 'partial':
        vx.text = ev.text;
        setTranscript(ev.text);
        if (vx.state === 'listening') armSilence(SILENCE_AFTER_SPEECH);
        break;
      case 'final':
        finish(ev.text || vx.text);
        break;
      case 'error':
        vx.state = 'done';
        setListening(false);
        renderError(ev);
        break;
      case 'end':
        if (vx.state !== 'done') finish(vx.text);
        break;
      default:
    }
  });

  function finish(text) {
    vx.state = 'done';
    clearTimeout(vx.silence);
    setListening(false);
    const intent = P.parse(text, Date.now(), state.tasks);
    handle(intent);
  }

  // ------------------------------------------------------------ intents
  function handle(it) {
    const active = T.activeTasks(state.tasks);
    switch (it.type) {
      case 'empty': return renderUnclear(it, true);
      case 'unknown': return renderUnclear(it, false);
      case 'cancel': close(); say(pick(SAY.cancel), { duration: 3000 }); return;
      case 'hide': close(); closePanel(); api.hide(); return;
      case 'close': close(); closePanel(); return;
      case 'view': close(); switchView(it.view); say(pick(SAY[it.view]), { duration: 3000 }); return;
      case 'query': return renderQuery(it);
      case 'create': return renderCreate(it);
      case 'done':
        if (!active.length) { close(); say(pick(SAY.nothingToDo), { duration: 4000 }); return; }
        if (it.match.best) return renderDone(it.match.best, it);
        return renderPick(it, it.match.candidates.length ? it.match.candidates : active, (t) => renderDone(t, it), 'Which assignment did you finish?');
      case 'extend':
        if (!active.length) { close(); say(pick(SAY.nothingToExtend), { duration: 4000 }); return; }
        if (it.match.best) return doExtend(it.match.best, it);
        return renderPick(it, it.match.candidates.length ? it.match.candidates : active, (t) => doExtend(t, it), 'Which assignment needs more time?');
      default: return renderUnclear(it, false);
    }
  }

  function renderCreate(it) {
    const now = Date.now();
    const title = h('input', { maxlength: 120, value: it.title || '', placeholder: 'What must be done?', spellcheck: 'false' });
    const due = h('input', { type: 'datetime-local', value: toLocalInput(it.at && it.at > now + 60e3 ? it.at : presetTime('+1h', now)) });
    const readout = h('div', { class: 'vx-readout' });
    const err = h('div', { class: 'error', role: 'alert' });
    const update = () => {
      const ms = fromLocalInput(due.value);
      const n = Date.now();
      readout.textContent = ms ? `⟶ ${new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toUpperCase()} · ${ms > n ? 'IN ' + T.formatDuration(ms - n).toUpperCase() : 'ALREADY PASSED'}` : '⟶ NO DEADLINE SET';
      readout.classList.toggle('bad', !ms || ms <= n);
    };
    due.addEventListener('input', update);
    const form = h('div', { class: 'form decree' });
    const confirm = () => {
      const t = title.value.trim();
      const ms = fromLocalInput(due.value);
      if (!t) { err.textContent = 'Every assignment needs a name, hon.'; title.focus(); return; }
      if (!ms || ms <= Date.now() + 60e3) { err.textContent = "That deadline's already passed. That's how Nexus events happen."; return; }
      stamp(form, 'APPROVED', () => { close(); addTask(t, ms); });
    };
    for (const inp of [title, due]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
    let note = null;
    if (!it.at) note = h('div', { class: 'warn', text: "I didn't hear a deadline, so I penciled in one hour from now. Change it above if you need to." });
    else if (it.at <= now + 60e3) note = h('div', { class: 'warn', text: "That time has already passed, hon. Pick a new one above." });
    else if (it.guessed) note = h('div', { class: 'note', text: `You didn't say AM or PM, so I assumed ${new Date(it.at).getHours() >= 12 ? 'PM' : 'AM'}. Fix it above if that's wrong.` });
    appendAll(form,
      h('div', { class: 'form-no', text: 'FORM TVA-VX1 · VOICE DECREE' }),
      h('h3', { text: 'New assignment' }),
      heard(it.heard),
      h('label', { text: 'ASSIGNMENT' }), title,
      h('label', { text: 'DUE' }), due, readout,
      note, err,
      actions(retryBtn(), closeBtn('Cancel'), primary('Stamp it', confirm)),
      h('div', { class: 'vx-stamp' }));
    show(form);
    update();
    setTimeout(() => (it.title ? $('.btn-primary', form) : title).focus(), 60);
  }

  function renderDone(t, it) {
    const now = Date.now();
    const late = now > t.dueAt;
    const form = h('div', { class: 'form decree' });
    const confirm = () => stamp(form, late ? 'LATE' : 'COMPLETE', () => {
      close();
      const card = $(`#task-list .task[data-id="${CSS.escape(t.id)}"]`);
      completeTask(t, card);
    }, late);
    appendAll(form,
      h('div', { class: 'form-no', text: 'FORM TVA-VX2 · COMPLETION REPORT' }),
      h('h3', { text: 'Mark assignment complete?' }),
      heard(it.heard),
      h('div', { class: 'subject', text: `“${t.title}” · ${late ? 'was due' : 'due'} ${T.formatDue(t.dueAt, now)}` }),
      late
        ? h('div', { class: 'warn', text: 'This one is past its deadline, so it goes in your file as late.' })
        : h('div', { class: 'note', text: `${T.formatRemaining(t, now)}. Finishing now counts as on time.` }),
      actions(retryBtn(), closeBtn('Cancel'), primary('✓ Complete', confirm)),
      h('div', { class: 'vx-stamp' }));
    show(form);
    setTimeout(() => $('.btn-primary', form).focus(), 60);
  }

  function doExtend(t, it) {
    close();
    let due = null;
    if (it.offsetFromBase) due = Math.max(Date.now(), t.dueAt) + it.offsetFromBase;
    else if (it.at) due = it.at;
    openPostponeModal(t, { due, reason: it.reason, voice: true });
  }

  function renderPick(it, candidates, onPick, question) {
    const now = Date.now();
    const list = h('div', { class: 'pick-list' });
    for (const t of candidates.slice(0, 6)) {
      list.append(h('button', { type: 'button', class: `pick s${Math.max(0, T.stageOf(t, now))}`, onclick: () => onPick(t) },
        h('span', { class: 't', text: t.title }),
        h('span', { class: 'd', text: T.formatRemaining(t, now) })));
    }
    show(h('div', { class: 'form decree' },
      h('div', { class: 'form-no', text: 'FORM TVA-VX3 · CLARIFICATION' }),
      h('h3', { text: question }),
      heard(it.heard),
      list,
      actions(retryBtn(), closeBtn('Cancel'))));
  }

  function renderQuery(it) {
    const now = Date.now();
    const endOf = (days) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(23, 59, 59, 999); return d.getTime(); };
    const active = T.activeTasks(state.tasks).sort((a, b) => a.dueAt - b.dueAt);
    let items;
    let label;
    switch (it.scope) {
      case 'overdue': items = active.filter((t) => t.dueAt < now); label = 'OVERDUE'; break;
      case 'tomorrow': items = active.filter((t) => t.dueAt > endOf(0) && t.dueAt <= endOf(1)); label = 'DUE TOMORROW'; break;
      case 'week': items = active.filter((t) => t.dueAt <= endOf(6)); label = 'DUE THIS WEEK'; break;
      case 'next': items = active.slice(0, 1); label = 'NEXT UP'; break;
      case 'all': items = active; label = 'ALL ACTIVE'; break;
      default: items = active.filter((t) => t.dueAt <= endOf(0)); label = 'DUE TODAY';
    }
    const names = (arr) => {
      const n = arr.slice(0, 3).map((t) => `“${short(t.title, 30)}” ${t.dueAt < now ? '(overdue)' : T.formatDue(t.dueAt, now)}`);
      return n.length < arr.length ? `${n.join(', ')} and ${arr.length - n.length} more` : n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0];
    };
    const when = { overdue: 'overdue', tomorrow: 'due tomorrow', week: 'due this week', all: 'on the timeline', today: 'due today' }[it.scope] || 'due today';
    let line;
    if (it.scope === 'next') line = items.length ? `Next up: “${short(items[0].title, 36)}”, ${T.formatRemaining(items[0], now)}.` : 'Nothing on the timeline. Enjoy it while it lasts!';
    else if (!items.length) line = it.scope === 'overdue' ? 'Nothing overdue. The timeline is holding!' : `Nothing ${when}. A tidy timeline!`;
    else {
      const od = items.filter((t) => t.dueAt < now).length;
      line = items.length === 1 ? `Just one ${when}: ${names(items)}.` : `${items.length} ${when}${od && it.scope !== 'overdue' ? `, ${od} already overdue` : ''}. It's all on the terminal, hon.`;
    }
    const overdueCount = items.filter((t) => t.dueAt < now).length;
    say(line, { duration: 9000, alarm: overdueCount > 0 });

    const list = h('div', { class: 'q-list' });
    if (!items.length) list.append(h('div', { class: 'q-empty', text: 'NO MATCHING ASSIGNMENTS' }));
    for (const t of items.slice(0, 8)) {
      list.append(h('div', { class: `q-item s${Math.max(0, T.stageOf(t, now))}` },
        h('i'),
        h('span', { class: 't', text: t.title }),
        h('span', { class: 'd', text: t.dueAt < now ? 'OVERDUE' : T.formatDue(t.dueAt, now) })));
    }
    show(h('div', { class: 'form decree' },
      h('div', { class: 'form-no', text: `TIMELINE QUERY · ${label}` }),
      h('h3', { text: items.length ? `${items.length} assignment${items.length === 1 ? '' : 's'}` : 'All clear' }),
      heard(it.heard),
      list,
      actions(retryBtn(), primary('Close', close))));
    setTimeout(() => $('.btn-primary', root)?.focus(), 60);
  }

  function renderUnclear(it, silent) {
    say(pick(silent ? SAY.silent : SAY.unclear), { duration: 4000 });
    show(h('div', { class: 'form decree' },
      h('div', { class: 'form-no', text: 'SIGNAL REPORT' }),
      h('h3', { text: silent ? 'No transmission received' : 'Transmission unclear' }),
      silent ? h('div', { class: 'note', text: 'Nothing came through. Check that the right microphone is selected in System Settings → Sound, and speak after the line starts moving.' }) : heard(it.heard),
      h('label', { text: 'THINGS I UNDERSTAND' }),
      h('ul', { class: 'vx-examples' }, ...EXAMPLES.map((e) => h('li', { text: e }))),
      actions(closeBtn(), h('button', { type: 'button', class: 'btn-primary', text: '↺ Speak again', onclick: () => listen() }))));
  }

  function renderPermission(what) {
    show(h('div', { class: 'form decree' },
      h('div', { class: 'form-no', text: 'CLEARANCE REQUEST' }),
      h('h3', { text: 'Awaiting clearance' }),
      h('div', { class: 'note', text: `macOS is asking whether Ms. Minutes may use ${what === 'mic' ? 'the microphone' : 'speech recognition'}. Click “Allow” in the system pop-up. It only asks once.` }),
      h('div', { class: 'vx-status busy' }, h('span', { class: 'txt', text: 'WAITING ON THE TIME-KEEPERS' }), h('span', { class: 'dots' })),
      actions(ghost('Cancel', () => cancel(true)))));
  }

  const ERRORS = {
    'mic-denied': { title: 'Audio link denied', body: 'macOS is blocking the microphone for Ms. Minutes. Turn it on in System Settings → Privacy & Security → Microphone, then try again.', fix: ['Open Microphone settings', 'mic'] },
    'speech-denied': { title: 'Translator offline', body: 'macOS is blocking Speech Recognition for Ms. Minutes. Turn it on in System Settings → Privacy & Security → Speech Recognition, then try again.', fix: ['Open Speech settings', 'speech'] },
    'no-on-device': { title: 'Offline speech not installed', body: "Your Mac's on-device speech model isn't downloaded. Turn on Dictation once in System Settings → Keyboard (that downloads it), then try again. I never send audio online.", fix: ['Open Keyboard settings', 'dictation'] },
    'dictation-off': { title: 'Dictation is switched off', body: 'macOS only lets apps use its speech recognizer when Dictation is on. Open System Settings → Keyboard, turn on Dictation (you can set its shortcut to Off so it never pops up by itself), then press the mic again. Recognition still stays on this Mac.', fix: ['Open Keyboard settings', 'dictation'] },
    unavailable: { title: 'Translator busy', body: "Apple's speech recognizer isn't available right now. Give it a moment and try again." },
    'no-mic': { title: 'No microphone found', body: 'I could not find a microphone. Check System Settings → Sound → Input.' },
    'mic-start': { title: 'Microphone would not start', body: 'Another app may be holding the microphone. Close it and try again.' },
    missing: { title: 'Voice module missing', body: 'The speech helper is not built. Run “npm run build:listener” (or “npm run package”) and restart.' },
    crashed: { title: 'Audio link severed', body: 'macOS stopped the speech helper. If you are running from source, use the packaged app in Applications. macOS only grants microphone access to real apps.' },
    spawn: { title: 'Audio link severed', body: 'The speech helper could not start.' },
  };
  function renderError(ev) {
    const e = ERRORS[ev.code] || { title: 'Audio link error', body: ev.message || 'Something went wrong with the microphone.' };
    say('The audio link is down, hon. Details are on the terminal.', { duration: 4500, alarm: true });
    show(h('div', { class: 'form decree error-card' },
      h('div', { class: 'form-no', text: `FAULT · ${String(ev.code || 'unknown').toUpperCase()}` }),
      h('h3', { text: e.title }),
      h('div', { class: 'warn', text: e.body }),
      actions(closeBtn(), e.fix ? primary(e.fix[0], () => api.openPrivacy(e.fix[1])) : h('button', { type: 'button', class: 'btn-primary', text: '↺ Try again', onclick: () => listen() }))));
  }

  function stamp(form, text, after, bad = false) {
    const s = $('.vx-stamp', form);
    $$('button', form).forEach((b) => { b.disabled = true; });
    if (!s) { after(); return; }
    s.textContent = text;
    s.classList.toggle('bad', bad);
    s.classList.add('on');
    setTimeout(after, 650);
  }

  // ------------------------------------------------------------ wiring
  micKey.addEventListener('click', () => listen());
  api.on('voice:hotkey', () => listen());

  // Dev-only: render each screen with canned input (snapshot mode).
  function debug(kind) {
    close();
    const now = Date.now();
    const fake = (text) => handle(P.parse(text, now, state.tasks));
    if (kind === 'listening') {
      vx.state = 'listening';
      vx.startedAt = now - 3400;
      renderListening();
      setListening(true);
      setStatus('RECEIVING TRANSMISSION');
      setTranscript('Create a new task, finish the lab report, due tomor');
      vx.fake = setInterval(() => { vx.levels.push(0.35 + Math.random() * 0.4); if (vx.levels.length > 60) vx.levels.shift(); }, 50);
    } else if (kind === 'create') fake('Ms. Minutes, create a new task, finish the lab report, due tomorrow at 9pm');
    else if (kind === 'create-guess') fake('Add a task study for the chem midterm due at 5');
    else if (kind === 'done') fake('Mark the history essay done');
    else if (kind === 'pick') fake('Mark it done');
    else if (kind === 'query') fake("What's due today?");
    else if (kind === 'unknown') fake('Banana bread recipe with extra walnuts');
    else if (kind === 'error-mic') renderError({ code: 'mic-denied' });
  }

  return { listen, cancel, isOpen, debug };
})();
