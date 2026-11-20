# Ms. Minutes

A TVA-style desktop accountability companion for macOS. Ms. Minutes floats in the bottom-right corner of your screen. Click her to log assignments with deadlines, and she gets angrier as each one gets close.

Personal project. The character belongs to Marvel, so don't distribute it.

## Run it

**As an app (recommended):** drag `dist/Ms. Minutes-darwin-arm64/Ms. Minutes.app` into `/Applications` and open it.
The first time, macOS will block it because it's unsigned. Right-click the app → **Open** → **Open**, or go to System Settings → Privacy & Security → **Open Anyway**.

**From source:** `npm install`, then `npm start`.
(The start script clears `ELECTRON_RUN_AS_NODE`, which VS Code's terminal sets and which would otherwise break Electron.)

**Rebuild the app after changes:** `npm run package`


| Action | How |
|---|---|
| Open or close the terminal | Click her (or press Esc) |
| Move her | Drag her |
| Hide or show her | × on hover, the clock icon in the menu bar, or **⌃⌥M** (Control-Option-M) |
| Quick status | Hover over her |
| Quit | Menu-bar clock → Quit, or Settings → Quit |

### How her mood works
Each task's anger is based on the share of its time window (from when you added it to its deadline) that has passed. The most urgent task sets her mood:

| Time used | Mood | Terminal status |
|---|---|---|
| 0–50% | Happy, pointing and smiling | NOMINAL |
| 50–75% | Skeptical, hands on hips | DIVERGING |
| 75–90% | Annoyed, foot tapping | UNSTABLE |
| 90–100% | Angry, shaking, steam | CRITICAL |
| Overdue | Furious, fist shaking, red alert | NEXUS EVENT |
| All done today | Proud, hopping, sparkles | PRISTINE |

### Accountability features
- **Friction to quit on a task.** Extending or pruning a task needs a written reason (15+ characters), and pruning also needs a 1.5-second hold. Tasks added less than 5 minutes ago can be removed freely, in case of typos. Every excuse is listed under *Records → Excuses on file*.
- **Missed deadlines still count.** Extending or pruning a task that's already overdue is recorded as a miss.
- **Streaks and stats.** A day counts toward your streak when at least one deadline that day was met on time and none were missed. Days with nothing due don't break a streak.
- **Daily check-ins.** A morning briefing (09:00 by default) and an evening review (20:00 by default).
- **Notifications.** Always silent, at most one every 5 minutes, at most one per task per stage, and none during quiet hours (22:00–08:00 by default). You can set them to *90% & overdue only* or *off*.
- **Return when overdue.** If you hide her and a deadline passes, she comes back once for that deadline.

## Permissions
- **Notifications:** allow them when macOS asks. Otherwise go to System Settings → Notifications → Ms. Minutes, turn on notifications, and choose *Banners*. Notifications are already silent, but you can also turn off *Play sound* there.
- **Launch at login:** turn it on in Settings or from the menu-bar clock. If macOS asks for approval, allow it under System Settings → General → Login Items.
- No Accessibility, Screen Recording or Full Disk Access is needed.

## Data
Everything is stored locally in `~/Library/Application Support/Ms. Minutes/` (`data.json` holds tasks and settings, `meta.json` holds notification bookkeeping and her position). Nothing is sent anywhere.

## Project layout
```
src/main/main.js        window, menu-bar icon, notifications, check-in scheduler, storage
src/main/preload.js     the bridge the page uses to talk to the main process
src/main/trayIcon.js    menu-bar clock icon, drawn in code
src/shared/timeline.js  mood stages, streak and stat math, time formatting
src/renderer/           Ms. Minutes (SVG), the TVA terminal UI, behavior
assets/reference/       the reference images she was drawn from
```

Dev screenshot mode: `MINUTES_SNAPSHOT=<out-dir> MINUTES_USER_DATA=<temp-dir> npm start` renders every mood and panel to PNGs, then exits.
