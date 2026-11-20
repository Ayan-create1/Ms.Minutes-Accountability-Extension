/*
 * Shared timeline logic: mood stages, stats/streaks, time formatting.
 * Loaded by the Electron main process (require) and the renderer (<script>).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Stage index -> what Ms. Minutes feels and what the terminal calls it.
  const STAGES = [
    { mood: 'happy', label: 'NOMINAL' },       // 0–50% of the time used
    { mood: 'skeptical', label: 'DIVERGING' }, // 50–75%
    { mood: 'annoyed', label: 'UNSTABLE' },    // 75–90%
    { mood: 'angry', label: 'CRITICAL' },      // 90–100%
    { mood: 'furious', label: 'NEXUS EVENT' }, // overdue
  ];

  const DEFAULT_SETTINGS = {
    notifications: 'all', // 'all' | 'urgent' | 'off'
    quietEnabled: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    checkins: true,
    morningTime: '09:00',
    eveningTime: '20:00',
    returnWhenOverdue: true,
    launchAtLogin: false,
  };

  function defaultData() {
    return { version: 1, tasks: [], settings: { ...DEFAULT_SETTINGS }, pendingCheckin: null, welcomed: false };
  }

  function normalizeData(d) {
    const base = defaultData();
    if (!d || typeof d !== 'object') return base;
    return {
      ...base,
      ...d,
      tasks: Array.isArray(d.tasks) ? d.tasks.map((t) => ({ postponements: [], ...t })) : [],
      settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    };
  }

  /** Fraction of the task's window (created -> due) that has elapsed. */
  function progress(task, now) {
    const total = task.dueAt - task.createdAt;
    if (total <= 0) return 1;
    return Math.max(0, (now - task.createdAt) / total);
  }

  /** 0..4 for active tasks, -1 otherwise. */
  function stageOf(task, now) {
    if (task.status !== 'active') return -1;
    if (now >= task.dueAt) return 4;
    const p = progress(task, now);
    if (p >= 0.9) return 3;
    if (p >= 0.75) return 2;
    if (p >= 0.5) return 1;
    return 0;
  }

  const activeTasks = (tasks) => tasks.filter((t) => t.status === 'active');

  function overallStage(tasks, now) {
    let s = -1;
    for (const t of tasks) s = Math.max(s, stageOf(t, now));
    return s;
  }

  /** Highest stage first, then earliest due. */
  function mostUrgent(tasks, now) {
    return activeTasks(tasks).sort((a, b) => stageOf(b, now) - stageOf(a, now) || a.dueAt - b.dueAt)[0] || null;
  }

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseHM(hm) {
    const [h, m] = String(hm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function inQuietHours(date, s) {
    if (!s.quietEnabled) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    const a = parseHM(s.quietStart);
    const b = parseHM(s.quietEnd);
    if (a === b) return false;
    return a < b ? m >= a && m < b : m >= a || m < b;
  }
  function shiftDay(now, days) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function formatDue(ms, now) {
    const k = dayKey(ms);
    if (k === dayKey(now)) return 'today at ' + formatTime(ms);
    if (k === dayKey(shiftDay(now, 1))) return 'tomorrow at ' + formatTime(ms);
    if (k === dayKey(shiftDay(now, -1))) return 'yesterday at ' + formatTime(ms);
    const d = new Date(ms);
    if (Math.abs(ms - now) < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' }) + ' at ' + formatTime(ms);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + formatTime(ms);
  }
  function formatDuration(ms) {
    const m = Math.floor(Math.abs(ms) / 60000);
    if (m < 1) return '<1m';
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${mm}m`;
    return `${mm}m`;
  }
  function formatRemaining(task, now) {
    const r = task.dueAt - now;
    return r >= 0 ? formatDuration(r) + ' left' : 'overdue by ' + formatDuration(r);
  }

  // ---------- stats ----------
  /*
   * Every deadline produces an outcome on the day it was due:
   *   ok   = completed on time
   *   fail = completed late, still open past due, pruned while overdue,
   *          or extended after it was already overdue
   *   pending = still open and not yet due
   * A day is "kept" if it has at least one ok and no fails. Streaks count
   * consecutive kept days; days with nothing due don't break a streak.
   */
  function computeStats(tasks, now) {
    const days = new Map();
    const bump = (key, field) => {
      if (!days.has(key)) days.set(key, { ok: 0, fail: 0, pending: 0 });
      days.get(key)[field]++;
    };
    let completed = 0, onTime = 0, late = 0, pruned = 0, prunedOverdue = 0, postponements = 0, overdueOpen = 0;

    for (const t of tasks) {
      for (const p of t.postponements || []) {
        postponements++;
        if (p.wasOverdue) bump(dayKey(p.fromDue), 'fail');
      }
      const k = dayKey(t.dueAt);
      if (t.status === 'done') {
        completed++;
        if (t.completedAt <= t.dueAt) { onTime++; bump(k, 'ok'); } else { late++; bump(k, 'fail'); }
      } else if (t.status === 'pruned') {
        pruned++;
        if (t.prunedWhileOverdue) { prunedOverdue++; bump(k, 'fail'); }
      } else if (t.status === 'active') {
        if (now > t.dueAt) { overdueOpen++; bump(k, 'fail'); } else bump(k, 'pending');
      }
    }

    const status = (key) => {
      const d = days.get(key);
      if (!d) return 'empty';
      if (d.fail) return 'fail';
      if (d.pending) return 'pending';
      return d.ok ? 'kept' : 'empty';
    };

    let streak = 0;
    for (let i = 0; i < 1000; i++) {
      const s = status(dayKey(shiftDay(now, -i)));
      if (s === 'kept') streak++;
      else if (s === 'fail') break;
    }

    const todayKey = dayKey(now);
    let best = 0, run = 0;
    for (const key of [...days.keys()].filter((k) => k <= todayKey).sort()) {
      const s = status(key);
      if (s === 'kept') best = Math.max(best, ++run);
      else if (s === 'fail') run = 0;
    }

    let okTotal = 0, failTotal = 0;
    for (const d of days.values()) { okTotal += d.ok; failTotal += d.fail; }

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const date = shiftDay(now, -i);
      const d = days.get(dayKey(date)) || { ok: 0, fail: 0, pending: 0 };
      last7.push({ key: dayKey(date), label: date.toLocaleDateString([], { weekday: 'narrow' }), ...d, isToday: i === 0 });
    }

    return {
      completed, onTime, late, pruned, prunedOverdue, postponements, overdueOpen,
      streak, bestStreak: Math.max(best, streak),
      rate: okTotal + failTotal ? okTotal / (okTotal + failTotal) : null,
      today: days.get(todayKey) || { ok: 0, fail: 0, pending: 0 },
      last7,
    };
  }

  return {
    STAGES, DEFAULT_SETTINGS, defaultData, normalizeData,
    progress, stageOf, activeTasks, overallStage, mostUrgent,
    dayKey, parseHM, inQuietHours, shiftDay,
    formatTime, formatDue, formatDuration, formatRemaining,
    computeStats,
  };
});
