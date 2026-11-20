'use strict';
// Runs the native speech helper (native/listener) for one listening session at a time
// and relays its JSON-line events to the renderer.
const { app, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let proc = null;
let session = 0;

function helperPath() {
  if (process.env.MINUTES_LISTENER && !app.isPackaged) return process.env.MINUTES_LISTENER; // dev: fake helper for tests
  return app.isPackaged
    ? path.join(process.resourcesPath, 'minutes-listener')
    : path.join(__dirname, '../../build/bin/minutes-listener');
}

/** `send(event)` receives {session, type, ...} objects. */
function start(send) {
  if (proc) return session;
  const id = ++session;
  const emit = (ev) => send({ session: id, ...ev });
  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    emit({ type: 'error', code: 'missing' });
    emit({ type: 'end' });
    return id;
  }
  let sawEnd = false;
  let sawError = false;
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  proc = child;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'error') sawError = true;
    if (ev.type === 'final' || ev.type === 'error') sawEnd = true;
    emit(ev);
  });
  child.on('error', (e) => {
    sawError = true;
    emit({ type: 'error', code: 'spawn', message: e.message });
  });
  child.on('exit', (code, signal) => {
    if (proc === child) proc = null;
    // Killed by macOS (e.g. a privacy check) without telling us why.
    if (!sawEnd && !sawError && signal !== 'SIGTERM' && (code || signal)) emit({ type: 'error', code: 'crashed', message: signal || `exit ${code}` });
    emit({ type: 'end' });
  });
  child.stdin.on('error', () => {});
  return id;
}

function command(cmd) {
  if (!proc) return;
  try { proc.stdin.write(cmd + '\n'); } catch { /* exiting */ }
}
const stop = () => command('stop');
function cancel() {
  if (!proc) return;
  const p = proc;
  command('cancel');
  setTimeout(() => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM'); }, 400);
}

const PRIVACY = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
  dictation: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension',
};
function openPrivacy(kind) {
  const url = PRIVACY[kind];
  if (url) shell.openExternal(url);
}

module.exports = { start, stop, cancel, openPrivacy, isActive: () => !!proc };
