# Ms. Minutes

A TVA-style desktop accountability companion for macOS. Ms. Minutes floats in the bottom-right corner of your screen. Click her to log assignments with deadlines, and she gets angrier as each one gets close.

Personal project. The character belongs to Marvel, so don't distribute it.

## Run it

**As an app (recommended):** drag `dist/Ms. Minutes-darwin-arm64/Ms. Minutes.app` into `/Applications` and open it.
The first time, macOS will block it because it's unsigned. Right-click the app → **Open** → **Open**, or go to System Settings → Privacy & Security → **Open Anyway**.

**From source:** `npm install`, then `npm start`.
(The start script clears `ELECTRON_RUN_AS_NODE`, which VS Code's terminal sets and which would otherwise break Electron.)

**Rebuild the app after changes:** `npm run package`. This compiles the Swift voice helper (needs Xcode's command-line tools), packages the app and re-signs it. Then copy the new `.app` into `/Applications`.


| Action | How |
|---|---|
| Open or close the terminal | Click her (or press Esc) |
| Move her | Drag her |
| Hide or show her | × on hover, the clock icon in the menu bar, or **⌃⌥M** (Control-Option-M) |
| Quick status | Hover over her |
| Talk to her | The orange mic button in the terminal, or **⌃⌥V** (Control-Option-V) from any app |
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

### Voice commands
Press the mic button or ⌃⌥V and talk. She stops listening on her own after a 2-second pause, or you can click *Done talking*. Saying "Ms. Minutes" first is optional.

| Say something like | What happens |
|---|---|
| "Create a new task, finish the lab report, due tomorrow at 9pm" | A *Voice Decree* card shows the title and deadline. Edit them if needed, then **Stamp it** |
| "Remind me to email Professor Lee in two hours" / "Add read chapter 4 due Friday" | Same as above |
| "Mark the history essay done" / "I finished the lab report" | A *Completion Report* asks you to confirm |
| "Extend the essay to Sunday because…" / "Push the lab report back an hour" | Opens the normal extension form with the date and reason filled in. The 15-character excuse rule still applies |
| "What's due today?" / "Anything overdue?" / "What's next?" | She answers in her bubble and lists the tasks on the terminal |
| "Open records" / "Open settings" / "Hide" / "Never mind" | Does what it says |

Deadlines understand phrases like *tomorrow, tonight, Friday, next Monday, November 21st, the 25th, in 2 hours, at 5, 9:30 pm, noon, end of day* and *this weekend*. If you don't say AM or PM, she picks the sensible one and tells you on the card. If there's no time, the deadline is 11:59 PM.

Speech is recognized by Apple's on-device recognizer, so audio never leaves your Mac. The microphone is only on while the red REC light is showing.

## Permissions
- **Notifications:** allow them when macOS asks. Otherwise go to System Settings → Notifications → Ms. Minutes, turn on notifications, and choose *Banners*. Notifications are already silent, but you can also turn off *Play sound* there.
- **Microphone and Speech Recognition:** the first time you use voice, macOS asks for each one. Click *Allow*. If you click *Don't Allow*, turn them back on in System Settings → Privacy & Security → *Microphone* and *Speech Recognition* (the error screen has a button that opens the right page). After a rebuild, macOS may ask again.
- **Launch at login:** turn it on in Settings or from the menu-bar clock. If macOS asks for approval, allow it under System Settings → General → Login Items.
- No Accessibility, Screen Recording or Full Disk Access is needed.

## Data
Everything is stored locally in `~/Library/Application Support/Ms. Minutes/` (`data.json` holds tasks and settings, `meta.json` holds notification bookkeeping and her position). Nothing is sent anywhere.

## Project layout
```
src/main/main.js        window, menu-bar icon, notifications, check-in scheduler, storage
src/main/preload.js     the bridge the page uses to talk to the main process
src/main/trayIcon.js    menu-bar clock icon, drawn in code
src/main/voice.js       starts/stops the speech helper and relays what it hears
native/listener/        Swift speech helper (Apple on-device speech recognition)
src/shared/timeline.js  mood stages, streak and stat math, time formatting
src/shared/voice.js     turns a spoken sentence into a command (task, deadline, etc.)
src/renderer/           Ms. Minutes (SVG), the TVA terminal UI, behavior; voice-ui.js is the voice screen
assets/reference/       the reference images she was drawn from
```

Dev screenshot mode: `MINUTES_SNAPSHOT=<out-dir> MINUTES_USER_DATA=<temp-dir> npm start` renders every mood and panel to PNGs, then exits.
