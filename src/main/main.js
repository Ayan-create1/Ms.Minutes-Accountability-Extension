'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, Notification, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const T = require('../shared/timeline');
const { createTrayIcon } = require('./trayIcon');

// Dev-only: MINUTES_USER_DATA isolates storage, MINUTES_SNAPSHOT=<dir> renders screenshots then exits.
if (process.env.MINUTES_USER_DATA) app.setPath('userData', process.env.MINUTES_USER_DATA);
const SNAPSHOT_DIR = process.env.MINUTES_SNAPSHOT || null;

const WIN_W = 440;
const WIN_H_MAX = 800;
const SHORTCUT = 'Control+Alt+M';
const NOTIFY_GAP_MS = 5 * 60 * 1000; // never more than one notification per 5 minutes

let win = null;
let tray = null;
let data = null; // owned by the renderer: tasks + settings
let meta = null; // owned by main: notification bookkeeping, window position
let dragOrigin = null;
let quitting = false;
let schedTimer = null;
const liveNotifications = new Set(); // keep references so click handlers survive GC

// ---------- persistence ----------
const files = () => {
  const dir = app.getPath('userData');
  return { data: path.join(dir, 'data.json'), meta: path.join(dir, 'meta.json') };
};
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function loadState() {
  data = T.normalizeData(readJSON(files().data, null));
  meta = { notified: {}, returned: {}, lastNotifyAt: 0, lastMorning: null, lastEvening: null, position: null, ...readJSON(files().meta, {}) };
}
const saveData = () => writeJSON(files().data, data);
const saveMeta = () => writeJSON(files().meta, meta);

// ---------- window ----------
function clampBounds(b) {
  const wa = screen.getDisplayMatching(b).workArea;
  return {
    ...b,
    x: Math.round(Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width)),
    y: Math.round(Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height)),
  };
}
function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = WIN_W;
  const height = Math.min(WIN_H_MAX, wa.height - 10);
  const pos = meta.position || { x: wa.x + wa.width - width - 6, y: wa.y + wa.height - height - 4 };
  return clampBounds({ x: pos.x, y: pos.y, width, height });
}

function createWindow() {
  win = new BrowserWindow({
    ...defaultBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Ms. Minutes',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Transparent areas pass clicks through to whatever is underneath; the
  // renderer turns this off while the cursor is over her or the panel.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => win.showInactive());
  win.webContents.once('did-finish-load', () => {
    startScheduler();
    if (SNAPSHOT_DIR) runSnapshots().catch((e) => { console.error(e); app.exit(1); });
  });
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); hideWindow(); }
  });
  win.on('show', rebuildTrayMenu);
  win.on('hide', rebuildTrayMenu);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWindow(openPanel = false) {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  if (openPanel) {
    app.focus({ steal: true });
    win.focus();
    win.webContents.send('panel:open');
  }
}
function hideWindow() { win && win.hide(); }
function toggleWindow() { win && (win.isVisible() ? hideWindow() : showWindow()); }
function resetPosition() {
  meta.position = null;
  saveMeta();
  win && win.setBounds(defaultBounds());
}
function reclamp() {
  if (!win) return;
  const b = clampBounds(win.getBounds());
  win.setPosition(b.x, b.y);
}

// ---------- tray ----------
function rebuildTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide Ms. Minutes' : 'Show Ms. Minutes', accelerator: SHORTCUT, registerAccelerator: false, click: toggleWindow },
    { label: 'Open Assignment Terminal', click: () => showWindow(true) },
    { type: 'separator' },
    {
      label: app.isPackaged ? 'Launch at Login' : 'Launch at Login (packaged app only)',
      type: 'checkbox',
      checked: !!data.settings.launchAtLogin,
      enabled: app.isPackaged,
      click: (item) => {
        data.settings.launchAtLogin = item.checked;
        applyLoginItem();
        saveData();
        win && win.webContents.send('settings:external', data.settings);
      },
    },
    { label: 'Reset Position', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit Ms. Minutes', click: () => { quitting = true; app.quit(); } },
  ]));
}
function updateTray(active, now) {
  if (!tray) return;
  const overdue = active.filter((t) => now >= t.dueAt).length;
  tray.setTitle(overdue ? String(overdue) : '', { fontType: 'monospacedDigit' });
  tray.setToolTip(`Ms. Minutes — ${active.length} active${overdue ? `, ${overdue} overdue` : ''}`);
}

// Returns null on success, otherwise a short status the Settings tab explains.
function applyLoginItem() {
  if (!app.isPackaged) return null; // in dev this would register the generic Electron binary
  const want = !!data.settings.launchAtLogin;
  try { app.setLoginItemSettings({ openAtLogin: want }); } catch { /* reported below */ }
  const st = app.getLoginItemSettings();
  let problem = null;
  if (want && !st.openAtLogin) problem = st.status === 'requires-approval' ? 'approval' : 'failed';
  win && win.webContents.send('login:status', problem);
  return problem;
}

// ---------- notifications & scheduling ----------
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  liveNotifications.add(n);
  n.on('click', () => onClick && onClick());
  n.on('close', () => liveNotifications.delete(n));
  n.show();
  setTimeout(() => liveNotifications.delete(n), 15 * 60 * 1000);
}

function sendTaskNotification(pending, now) {
  pending.sort((a, b) => b.st - a.st || a.t.dueAt - b.t.dueAt);
  const { t, st } = pending[0];
  const due = T.formatDue(t.dueAt, now);
  let body;
  if (pending.length > 1) body = `${pending.length} assignments need attention. Most urgent: "${t.title}" (${T.formatRemaining(t, now)}).`;
  else if (st === 2) body = `Three-quarters of your time on "${t.title}" is gone. It's due ${due}.`;
  else if (st === 3) body = `"${t.title}" is due ${due} (${T.formatRemaining(t, now)}). The timeline is branching!`;
  else body = `Variant detected! "${t.title}" was due ${due}.`;
  notify(st === 4 ? 'Ms. Minutes · Nexus Event' : 'Ms. Minutes', body, () => showWindow(true));
}

function fireCheckin(type, day, quiet) {
  win && win.webContents.send('checkin', { type, day });
  // Only reach out with a notification if she's hidden; otherwise her speech bubble is enough.
  if (win && !win.isVisible() && !quiet && data.settings.notifications !== 'off') {
    notify('Ms. Minutes', type === 'morning'
      ? 'Good morning! Your daily briefing is ready.'
      : 'Evening review time. Let\'s see how today\'s timeline held up.', () => showWindow(true));
  }
}

function checkins(now, s, quiet) {
  if (!s.checkins) return;
  const date = new Date(now);
  const today = T.dayKey(date);
  const m = date.getHours() * 60 + date.getMinutes();
  const morning = T.parseHM(s.morningTime);
  const evening = T.parseHM(s.eveningTime);
  if (m >= evening) {
    if (meta.lastEvening !== today) { meta.lastEvening = today; meta.lastMorning = today; fireCheckin('evening', today, quiet); }
  } else if (m >= morning && meta.lastMorning !== today) {
    meta.lastMorning = today;
    fireCheckin('morning', today, quiet);
  }
}

function tick() {
  if (!data) return;
  const now = Date.now();
  const s = data.settings;
  const active = T.activeTasks(data.tasks);
  const quiet = T.inQuietHours(new Date(now), s);
  const minStage = s.notifications === 'urgent' ? 3 : 2;
  const canNotify = s.notifications !== 'off' && !quiet && !SNAPSHOT_DIR;
  const pending = [];
  const live = new Set();
  let shouldReturn = false;

  for (const t of active) {
    // Keyed by deadline, so an extension starts a fresh notification cycle.
    const key = `${t.id}:${t.dueAt}`;
    live.add(key);
    const st = T.stageOf(t, now);
    if (st === 4 && s.returnWhenOverdue && !meta.returned[key]) { meta.returned[key] = true; shouldReturn = true; }
    const prev = meta.notified[key];
    if (prev === undefined) { meta.notified[key] = st; continue; } // first sighting: don't alert retroactively
    if (st <= prev) continue;
    if (canNotify && st >= minStage) pending.push({ t, st, key });
    else meta.notified[key] = st; // below threshold or quiet hours: skip, don't queue up a flood
  }
  for (const k of Object.keys(meta.notified)) if (!live.has(k)) delete meta.notified[k];
  for (const k of Object.keys(meta.returned)) if (!live.has(k)) delete meta.returned[k];

  if (pending.length && now - meta.lastNotifyAt >= NOTIFY_GAP_MS) {
    sendTaskNotification(pending, now);
    for (const p of pending) meta.notified[p.key] = p.st;
    meta.lastNotifyAt = now;
  }
  if (shouldReturn && win && !win.isVisible()) showWindow();

  checkins(now, s, quiet);
  updateTray(active, now);
  saveMeta();
}

let soonTimer = null;
function tickSoon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(tick, 800);
}
function startScheduler() {
  if (schedTimer) return;
  tick();
  schedTimer = setInterval(tick, 30 * 1000);
  powerMonitor.on('resume', tickSoon);
  powerMonitor.on('unlock-screen', tickSoon);
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => ({
    data,
    env: { isPackaged: app.isPackaged, snapshot: !!SNAPSHOT_DIR, shortcut: '⌃⌥M' },
  }));
  ipcMain.on('state:save', (_e, next) => {
    if (!next || !Array.isArray(next.tasks)) return;
    const prevLogin = data.settings.launchAtLogin;
    data = T.normalizeData(next);
    saveData();
    if (data.settings.launchAtLogin !== prevLogin) applyLoginItem();
    rebuildTrayMenu();
    tickSoon();
  });
  ipcMain.on('mouse:ignore', (_e, ignore) => win && win.setIgnoreMouseEvents(ignore, { forward: true }));
  ipcMain.on('drag:start', () => {
    if (!win) return;
    const c = screen.getCursorScreenPoint();
    const [x, y] = win.getPosition();
    dragOrigin = { cx: c.x, cy: c.y, x, y };
  });
  ipcMain.on('drag:move', () => {
    if (!win || !dragOrigin) return;
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(dragOrigin.x + c.x - dragOrigin.cx), Math.round(dragOrigin.y + c.y - dragOrigin.cy));
  });
  ipcMain.on('drag:end', () => {
    if (!win || !dragOrigin) return;
    const moved = win.getPosition()[0] !== dragOrigin.x || win.getPosition()[1] !== dragOrigin.y;
    dragOrigin = null;
    if (!moved) return;
    reclamp();
    const [x, y] = win.getPosition();
    meta.position = { x, y };
    saveMeta();
  });
  ipcMain.on('window:focus', () => { if (win) { app.focus({ steal: true }); win.focus(); } });
  ipcMain.on('window:hide', hideWindow);
  ipcMain.on('window:reset', resetPosition);
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
}

// ---------- dev snapshots ----------
async function runSnapshots() {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code);
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const shot = async (name, delay = 900) => {
    await wait(delay);
    const img = await win.capturePage();
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}.png`), img.toPNG());
  };
  await wait(800);
  await js(`document.body.style.background = '#55657a'`);
  for (const m of ['happy', 'skeptical', 'annoyed', 'angry', 'furious', 'proud']) {
    await js(`window.__debug.mood(${JSON.stringify(m)})`);
    await shot(`mood-${m}`);
  }
  await js(`window.__debug.mood(null); window.__debug.seed(); window.__debug.open('timeline')`);
  await shot('panel-timeline', 1400);
  await js(`window.__debug.checkin('evening')`);
  await shot('panel-evening');
  await js(`window.__debug.dismissBanner(); window.__debug.open('records')`);
  await shot('panel-records');
  await js(`window.__debug.open('settings')`);
  await shot('panel-settings');
  await js(`window.__debug.open('timeline'); window.__debug.modal('postpone')`);
  await shot('modal-postpone');
  await js(`window.__debug.closeModal(); window.__debug.modal('prune')`);
  await shot('modal-prune');
  app.exit(0);
}

// ---------- lifecycle ----------
if (!SNAPSHOT_DIR && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow(true));
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    loadState();
    registerIpc();
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Ms. Minutes');
    createWindow();
    rebuildTrayMenu();
    globalShortcut.register(SHORTCUT, toggleWindow);
    screen.on('display-metrics-changed', reclamp);
    screen.on('display-removed', reclamp);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { /* keep running in the menu bar */ });
}
