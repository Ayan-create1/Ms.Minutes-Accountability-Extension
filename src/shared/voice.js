/* Voice command understanding for Ms. Minutes.
 * Turns a spoken transcript ("Ms. Minutes, create a new task, finish the lab
 * report, due tomorrow at 9pm") into an intent the renderer can act on.
 * Pure functions, no dependencies; runs in the renderer (window.Voice) and in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Voice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60e3;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // ------------------------------------------------------------ normalizing
  const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  const suffix = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  function wordsToDigits(s) {
    const tens = Object.keys(TENS).join('|');
    const ones = Object.keys(ONES).filter((w) => w !== 'oh' && w !== 'zero').join('|');
    const ords = Object.keys(ORD).join('|');
    // "twenty first" -> 21st, "twenty five" -> 25
    s = s.replace(new RegExp(`\\b(${tens})[\\s-](${ords})\\b`, 'g'), (_, t, o) => { const n = TENS[t] + ORD[o]; return n + suffix(n); });
    s = s.replace(new RegExp(`\\b(${ords})\\b`, 'g'), (_, o) => ORD[o] + suffix(ORD[o]));
    s = s.replace(new RegExp(`\\b(${tens})[\\s-](${ones})\\b`, 'g'), (_, t, o) => String(TENS[t] + ONES[o]));
    s = s.replace(new RegExp(`\\b(${tens})\\b`, 'g'), (_, t) => String(TENS[t]));
    // "nine oh five" -> "9:05"
    s = s.replace(new RegExp(`\\b(${ones})\\s+oh\\s+(${ones})\\b`, 'g'), (_, h, m) => `${ONES[h]}:0${ONES[m]}`);
    s = s.replace(new RegExp(`\\b(${ones})\\b`, 'g'), (_, o) => String(ONES[o]));
    return s;
  }

  const WAKE = /^\s*(?:(?:hey|hi|ok(?:ay)?|yo|so|um+|uh+)[\s,]+)?(?:ms|miss|mrs|mis|misses|mz|mister)\.?\s*minutes?\b[\s,.:!?-]*/i;

  function normalize(text) {
    let s = String(text || '').trim();
    s = s.replace(WAKE, '');
    s = s.toLowerCase()
      .replace(/[“”"]/g, '')
      .replace(/[’‘`]/g, "'")
      .replace(/\b([ap])\.\s?m\.?/g, '$1m')
      .replace(/\b(\d{1,2})([ap]m)\b/g, '$1 $2')
      .replace(/\b(\d{1,2})\s*([ap])\s*m\b/g, '$1 $2m')
      .replace(/\btmrw\b|\btomorow\b|\btmr\b/g, 'tomorrow')
      .replace(/\bto-?night\b/g, 'tonight')
      .replace(/\bo'? ?clock\b/g, "o'clock")
      .replace(/\ban hour and a half\b/g, '90 minutes')
      .replace(/\bhalf an hour\b|\ba half hour\b|\bhalf hour\b/g, '30 minutes')
      .replace(/\ba quarter (of )?an hour\b/g, '15 minutes')
      .replace(/\ba couple(?: of)?\b/g, '2')
      .replace(/\ba few\b/g, '3');
    s = wordsToDigits(s);
    s = s.replace(/\b(\d+) and a half (hours?|days?)\b/g, (_, n, u) => (u.startsWith('h') ? `${+n * 60 + 30} minutes` : `${+n * 24 + 12} hours`));
    s = s.replace(/\b(an?|one)\s+(minute|hour|day|week)\b/g, '1 $2');
    // keep ":" in times, drop other punctuation
    s = s.replace(/[.,!?;]+(?=\s|$)/g, ' ').replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ').trim();
    return s;
  }

  // ------------------------------------------------------------ date/time parsing
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const monthIndex = (m) => MONTHS.findIndex((x) => x.startsWith(m.slice(0, 3)));
  const PART_DEFAULT = { morning: [9, 0], afternoon: [15, 0], evening: [19, 0], night: [21, 0], tonight: [23, 59] };

  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  const atTime = (dayMs, h, m) => { const d = new Date(dayMs); d.setHours(h, m, 0, 0); return d.getTime(); };

  /**
   * Find every date/time expression in `s`. Returns the resolved deadline plus the
   * character spans that were consumed (so the caller can strip them from a title).
   * `opts.relativeBase` makes bare durations ("by an hour", "2 days") count from that
   * moment instead of from now (used when extending an existing deadline).
   */
  function parseWhen(s, now = Date.now(), opts = {}) {
    const spans = [];
    let masked = s;
    const take = (re, fn) => {
      masked = masked.replace(re, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        if (fn(...args) === false) return match;
        spans.push([offset, offset + match.length, match]);
        return ' '.repeat(match.length);
      });
    };
    const unitMs = (u) => (u.startsWith('m') ? MIN : u.startsWith('h') ? HOUR : u.startsWith('d') ? DAY : 7 * DAY);

    let offsetFromNow = null; // minutes/hours relative to now
    let offsetFromBase = null; // extension amounts ("by 2 hours")
    let dayOffset = null;      // relative whole days/weeks
    let date = null;           // start-of-day ms
    let explicitDate = false;
    let hour = null, minute = 0, meridiem = null, part = null;

    // relative amounts
    take(/\b(?:in|within)\s+(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?)\b/g, (_, n, u) => {
      const ms = +n * unitMs(u);
      if (ms >= DAY) dayOffset = Math.round(ms / DAY); else offsetFromNow = ms;
    });
    take(/\b(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?)\s+from\s+(?:now|today)\b/g, (_, n, u) => {
      const ms = +n * unitMs(u);
      if (ms >= DAY) dayOffset = Math.round(ms / DAY); else offsetFromNow = ms;
    });
    if (opts.relativeBase != null) {
      take(/\b(?:(?:back|out|forward)\s+)?(?:by\s+|for\s+|another\s+|an extra\s+|extra\s+)?(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?)(?:\s+(?:more|later|longer|extra))?\b/g, (_, n, u) => {
        offsetFromBase = +n * unitMs(u);
      });
    }

    // whole-day phrases
    take(/\b(?:by\s+|at\s+)?(?:the\s+)?end of (?:the\s+)?day\b|\beod\b/g, () => { date = startOfDay(now); hour = 23; minute = 59; meridiem = 'x'; explicitDate = true; });
    take(/\b(?:by\s+)?(?:the\s+)?end of (?:the\s+|this\s+)?week\b/g, () => {
      const dow = new Date(now).getDay();
      date = startOfDay(addDays(now, (5 - dow + 7) % 7)); explicitDate = true; part = part || 'tonight';
    });
    take(/\b(?:the\s+)?day after tomorrow\b/g, () => { date = startOfDay(addDays(now, 2)); explicitDate = true; });
    take(/\btomorrow(?:\s+(morning|afternoon|evening|night))?\b/g, (_, p) => { date = startOfDay(addDays(now, 1)); explicitDate = true; if (p) part = p; });
    take(/\btoday\b/g, () => { date = startOfDay(now); explicitDate = true; });
    take(/\btonight\b/g, () => { if (date == null) date = startOfDay(now); part = 'tonight'; explicitDate = true; });
    take(/\bthis\s+(morning|afternoon|evening)\b/g, (_, p) => { date = startOfDay(now); part = p; explicitDate = true; });
    take(/\b(?:(this|next|on|coming)\s+)?(?:this\s+)?weekend\b/g, (_, w) => {
      const dow = new Date(now).getDay();
      let n = (6 - dow + 7) % 7;
      if (w === 'next') n += 7;
      date = startOfDay(addDays(now, n)); explicitDate = true;
    });
    take(new RegExp(`\\b(?:(this|next|on|coming|by)\\s+)?(${DAYS.join('|')})s?(?:\\s+(morning|afternoon|evening|night))?\\b`, 'g'), (_, w, d, p) => {
      const dow = new Date(now).getDay();
      const target = DAYS.indexOf(d);
      let n = (target - dow + 7) % 7;
      if (w === 'next' && n !== 0 && dow !== 0 && target > dow) n += 7; // "next friday" said on a tuesday = the one after this week's
      if (n === 0 && w === 'next') n = 7;
      date = startOfDay(addDays(now, n));
      explicitDate = true;
      if (p) part = p;
      if (n === 0) date = startOfDay(now); // "friday" said on friday = today (pushed a week below if already past)
    });
    take(new RegExp(`\\b(?:on\\s+)?${MONTH_RE}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'), (_, m, d) => {
      const mi = monthIndex(m);
      if (mi < 0 || +d < 1 || +d > 31) return false;
      const y = new Date(now).getFullYear();
      let t = new Date(y, mi, +d).getTime();
      if (t < startOfDay(now)) t = new Date(y + 1, mi, +d).getTime();
      date = t; explicitDate = true;
    });
    take(new RegExp(`\\b(?:on\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+${MONTH_RE})?\\b`, 'g'), (_, d, m) => {
      const n = new Date(now);
      let mi = m ? monthIndex(m) : n.getMonth();
      let y = n.getFullYear();
      let t = new Date(y, mi, +d).getTime();
      if (t < startOfDay(now)) { if (m) y += 1; else mi += 1; t = new Date(y, mi, +d).getTime(); }
      date = t; explicitDate = true;
    });
    take(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\b/g, (_, mo, d) => {
      const y = new Date(now).getFullYear();
      let t = new Date(y, +mo - 1, +d).getTime();
      if (t < startOfDay(now)) t = new Date(y + 1, +mo - 1, +d).getTime();
      date = t; explicitDate = true;
    });

    // times of day
    const setTime = (h, m, mer) => { hour = +h; minute = +(m || 0); meridiem = mer || null; };
    take(/\b(?:at\s+|by\s+|before\s+|around\s+)?(noon|midday|midnight)\b/g, (_, w) => { if (w === 'midnight') { hour = 23; minute = 59; meridiem = 'x'; } else setTime(12, 0, 'pm'); });
    take(/\b(?:at\s+|by\s+|before\s+|around\s+)?(half|quarter)\s+(past|after|to|till|til)\s+(\d{1,2})\b/g, (_, q, dir, h) => {
      const mins = q === 'half' ? 30 : 15;
      if (dir === 'past' || dir === 'after') setTime(+h, mins);
      else setTime(+h === 1 ? 12 : +h - 1, 60 - mins);
    });
    take(/\b(?:at\s+|by\s+|before\s+|around\s+)?(\d{1,2})(?::(\d{2})|\s(\d{2}))?\s*(am|pm)\b/g, (_, h, m1, m2, mer) => {
      if (+h > 12 || +h === 0) return false;
      setTime(h, m1 || m2, mer);
    });
    take(/\b(?:at\s+|by\s+|before\s+|around\s+)?(\d{1,2}):(\d{2})\b/g, (_, h, m) => { if (+h > 23 || +m > 59) return false; setTime(h, m, +h > 12 || +h === 0 ? 'x' : null); });
    take(/\b(?:at\s+|by\s+|before\s+|around\s+)?(\d{1,2})\s+o'clock\b/g, (_, h) => { if (+h > 12) return false; setTime(h, 0); });
    take(/\b(?:at|by|before|around)\s+(\d{1,2})(?:\s(\d{2}))?\b(?!\s*(?:min|hour|hr|day|week|st|nd|rd|th|\/))/g, (_, h, m) => {
      if (+h > 23 || (m && +m > 59)) return false;
      setTime(h, m, +h > 12 || +h === 0 ? 'x' : null);
    });
    take(/\b(?:in the\s+)(morning|afternoon|evening)\b|\bat night\b/g, (m, p) => { part = p || 'night'; });

    const found = spans.length > 0;
    let at = null;
    let guessed = false;

    if (offsetFromBase != null) {
      return { found, spans, masked, offsetFromBase, at: null, guessed: false };
    }
    if (offsetFromNow != null && hour == null && date == null) {
      at = Math.ceil((now + offsetFromNow) / MIN) * MIN;
    } else if (found) {
      if (dayOffset != null) { date = startOfDay(addDays(now, dayOffset)); explicitDate = true; }
      // resolve hour
      let h = hour, m = minute;
      if (h != null && meridiem == null) {
        if (h === 12) h = 12;
        else if (part === 'morning') h = h % 12;
        else if (part) h = (h % 12) + 12;
        else if (h >= 1 && h <= 11) {
          const day0 = date == null ? startOfDay(now) : date;
          if (date == null || date === startOfDay(now)) {
            // soonest of: h am today, h pm today, h am tomorrow
            const cands = [atTime(day0, h, m), atTime(day0, h + 12, m), atTime(addDays(day0, 1), h, m)];
            const c = cands.find((t) => t > now + MIN);
            h = new Date(c).getHours();
            if (date == null && new Date(c).getDate() !== new Date(now).getDate()) date = startOfDay(c);
          } else {
            h = h >= 7 ? h : h + 12; // other days: 7–11 → morning, 1–6 → afternoon/evening
          }
          guessed = true;
        }
      } else if (h != null && meridiem) {
        if (meridiem === 'pm' && h < 12) h += 12;
        if (meridiem === 'am' && h === 12) h = 0;
      }
      if (h == null) {
        if (part) [h, m] = PART_DEFAULT[part];
        else [h, m] = [23, 59];
      }
      if (date == null) {
        date = startOfDay(now);
        if (atTime(date, h, m) <= now + MIN) date = startOfDay(addDays(now, 1));
      } else if (!explicitDate) {
        // nothing
      }
      at = atTime(date, h, m);
      // a weekday said on the same weekday but already past → next week
      if (at <= now + MIN && explicitDate && date === startOfDay(now) && spans.some((sp) => new RegExp(DAYS.join('|')).test(sp[2]))) at = addDays(at, 7);
    }
    return { found, spans, masked, at, guessed, hasTime: hour != null || part != null };
  }

  // ------------------------------------------------------------ task matching
  const STOP = new Set(['the', 'a', 'an', 'my', 'task', 'assignment', 'as', 'done', 'complete', 'completed', 'finished', 'for', 'to', 'of', 'on', 'with', 'it', 'that', 'this', 'one', 'i', 'is', 'thing', 'please', 'now', 'just', 'off', 'item', 'todo']);
  const tok = (s) => normalize(s).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).map((w) => w.replace(/'s$/, '').replace(/(?<=..)s$/, '')).filter((w) => w && !STOP.has(w));
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function matchTasks(query, tasks) {
    const q = tok(query);
    if (!q.length) return { best: tasks.length === 1 ? tasks[0] : null, candidates: tasks.slice(), confident: tasks.length === 1 };
    const scored = tasks.map((t) => {
      const words = tok(t.title);
      let sum = 0;
      for (const w of q) {
        let best = 0;
        for (const x of words) {
          if (x === w) best = 1;
          else if (w.length >= 3 && (x.startsWith(w) || w.startsWith(x)) && Math.min(w.length, x.length) >= 3) best = Math.max(best, 0.8);
          else if (w.length >= 4 && lev(w, x) <= 1) best = Math.max(best, 0.7);
        }
        sum += best;
      }
      const cover = words.length ? Math.min(1, sum / words.length) : 0;
      return { task: t, score: sum / q.length * 0.85 + cover * 0.15 };
    }).filter((x) => x.score >= 0.34).sort((a, b) => b.score - a.score);
    const top = scored[0];
    const confident = !!top && top.score >= 0.5 && (!scored[1] || top.score - scored[1].score >= 0.12);
    return { best: confident ? top.task : null, candidates: scored.map((x) => x.task), confident };
  }

  // ------------------------------------------------------------ title cleanup
  function cleanTitle(s) {
    let t = s.replace(/\s+/g, ' ').trim();
    let prev;
    do {
      prev = t;
      t = t.replace(/^(?:and\s+|to\s+|called\s+|named\s+|titled\s+|that says\s+|saying\s+|which is\s+|for\s+|is\s+|-\s*|:\s*)/, '')
        .replace(/(?:\s+|^)(?:and\s+)?(?:(?:it'?s|that'?s|which is|it is|thats|is)\s+)?(?:due|by|on|at|before|for|until|til|till|and|in|the)$/, '')
        .replace(/\s+(?:due|that'?s due|which is due|it'?s due)\s+(?=\S)/, ' ')
        .trim();
    } while (t !== prev);
    t = t.replace(/^[^a-z0-9]+|[^a-z0-9)'"]+$/gi, '').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }
  /** Recover the speaker's original casing ("Professor Lee") when the words still line up. */
  function restoreCase(title, heard) {
    if (!title) return title;
    const words = title.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = heard.match(new RegExp(`\\b${words.join('[\\s,.;:-]+')}\\b`, 'i'));
    if (!m) return title;
    const t = m[0].replace(/[\s,;]+/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const stripSpans = (s, spans) => {
    let out = s;
    for (const [a, b] of spans) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b);
    return out.replace(/\s+/g, ' ').trim();
  };

  // ------------------------------------------------------------ intents
  const CREATE_PREFIX = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:(?:create|add|make|log|file|set up|setup|start|put|schedule|enter|record)\s+(?:me\s+|in\s+|down\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:task|assignment|to-?do|todo|reminder|item|deadline|entry)?s?|new\s+(?:task|assignment|to-?do|todo|reminder|item)|(?:remind me to|i need to|i have to|i've got to|i got to|i gotta|i must|i should|i want to|my next task is))\b\s*(?:called|named|titled|to|that says|saying|for)?\s*/;
  const DONE_RE = [
    /^(?:please\s+)?(?:mark|set|check off|cross off|tick off)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished|off)$/,
    /^(?:please\s+)?(?:mark|check off|cross off|tick off)\s+(.+?)$/,
    /^(?:i\s+)?(?:just\s+)?(?:finished|completed|did|submitted|turned in|handed in|wrapped up)\s+(.+?)$/,
    /^(?:i'?m|i am)\s+(?:all\s+)?(?:done|finished) with\s+(.+?)$/,
    /^(?:done|finished) with\s+(.+?)$/,
    /^(.+?)\s+is\s+(?:all\s+)?(?:done|finished|complete|completed|submitted)$/,
  ];
  const EXTEND_RE = /^(?:please\s+)?(?:(?:can|could) (?:you|i)\s+)?(?:extend|postpone|push(?:\s+back)?|delay|move|reschedule|bump|give me more time (?:on|for))\s+(.+)$/;
  const REASON_RE = /\s+(?:because|cause|'cause|cuz|since|the reason is|reason)\s+(.+)$/;
  const QUERY_RE = /^(?:what|whats|what's|which|do i have|have i got|is there|are there|anything|how am i|how's my|hows my|list|tell me|read|give me|any)\b|\bwhat's (?:due|left|next)|\b(?:due|left) today\b|\bstatus\b/;

  function viewIntent(s) {
    if (/\b(?:open|show|go to|pull up|switch to|take me to|view|see|bring up|check)\b/.test(s) || /^(?:records?|stats|settings|timeline)$/.test(s)) {
      if (/\b(?:records?|stats|statistics|history|streaks?|excuses|permanent record|file|report)\b/.test(s)) return 'records';
      if (/\b(?:settings|preferences|configuration|config|options)\b/.test(s)) return 'settings';
      if (/\b(?:timeline|tasks|assignments|terminal|list|to-?dos?)\b/.test(s) && !/\b(?:due|left|next)\b/.test(s)) return 'timeline';
    }
    return null;
  }

  /**
   * @returns one of
   *  {type:'empty'} | {type:'cancel'} | {type:'hide'} | {type:'close'}
   *  {type:'view', view}
   *  {type:'query', scope: 'today'|'tomorrow'|'overdue'|'next'|'week'|'all'}
   *  {type:'create', title, at, guessed, whenText, hasDue}
   *  {type:'done', query, match}
   *  {type:'extend', query, match, at, offsetFromBase, whenText, reason}
   *  {type:'unknown'}
   */
  function parse(text, now = Date.now(), tasks = []) {
    const s = normalize(text);
    const heard = String(text || '').trim();
    const base = { heard, normalized: s };
    if (!s) return { type: 'empty', ...base };
    if (/^(?:never ?mind|cancel|forget (?:it|that)|nothing|no thanks?|stop listening|stop)$/.test(s)) return { type: 'cancel', ...base };
    if (/^(?:hide|go away|bye|goodbye|good bye|dismiss|disappear|vanish|that'?s all|thanks? that'?s all|thank you that'?s all|hide yourself|go hide)\b/.test(s)) return { type: 'hide', ...base };
    if (/^(?:close|shut)(?:\s+(?:the|your))?(?:\s+(?:terminal|panel|window|screen))?$/.test(s)) return { type: 'close', ...base };

    const v = viewIntent(s);
    if (v && v !== 'timeline') return { type: 'view', view: v, ...base };

    // extend
    const ex = s.match(EXTEND_RE);
    if (ex) {
      let rest = ex[1];
      let reason = '';
      const r = rest.match(REASON_RE);
      if (r) { reason = r[1].trim(); rest = rest.slice(0, r.index); }
      const active = tasks.filter((t) => t.status === 'active');
      const when = parseWhen(rest, now, { relativeBase: true });
      const query = stripSpans(rest, when.spans).replace(/\b(?:to|until|till|til|by|back|out|forward|for|deadline|due date|the deadline (?:for|on|of))\b/g, ' ').replace(/\s+/g, ' ').trim();
      const m = matchTasks(query, active);
      return {
        type: 'extend', query, match: m, reason: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '',
        at: when.at, offsetFromBase: when.offsetFromBase ?? null, guessed: when.guessed,
        whenText: when.spans.map((x) => x[2].trim()).join(' '), ...base,
      };
    }

    // done
    for (const re of DONE_RE) {
      const d = s.match(re);
      if (d) {
        const query = d[1].replace(/^(?:the\s+)?(?:task|assignment)\s+/, '').trim();
        const active = tasks.filter((t) => t.status === 'active');
        return { type: 'done', query, match: matchTasks(query, active), ...base };
      }
    }

    // questions
    if (QUERY_RE.test(s) && !CREATE_PREFIX.test(s)) {
      let scope = 'today';
      if (/\boverdue|late|missed|behind\b/.test(s)) scope = 'overdue';
      else if (/\btomorrow\b/.test(s)) scope = 'tomorrow';
      else if (/\bweek\b/.test(s)) scope = 'week';
      else if (/\bnext\b|\bmost urgent\b|\bfirst\b/.test(s)) scope = 'next';
      else if (/\btoday\b|\btonight\b/.test(s)) scope = 'today';
      else if (/\b(?:all|everything|left|remaining|plate|timeline|tasks|assignments|status|how am i|how'?s my)\b/.test(s)) scope = 'all';
      return { type: 'query', scope, ...base };
    }
    if (v === 'timeline') return { type: 'view', view: v, ...base };

    // create (explicit prefix, or anything that carries a deadline)
    const pre = s.match(CREATE_PREFIX);
    const body = pre ? s.slice(pre[0].length) : s;
    const when = parseWhen(body, now);
    // "complete the essay" / "finish the lab report" with no deadline = finishing an existing task
    const imp = !pre && !when.found && s.match(/^(?:complete|finish)\s+(.+)$/);
    if (imp) {
      const m = matchTasks(imp[1], tasks.filter((t) => t.status === 'active'));
      if (m.confident) return { type: 'done', query: imp[1], match: m, ...base };
    }
    if (pre || when.found || imp) {
      const title = restoreCase(cleanTitle(stripSpans(body, when.spans)), heard);
      return {
        type: 'create', title, at: when.at, guessed: when.guessed, hasDue: when.at != null,
        whenText: when.spans.map((x) => x[2].trim()).join(' '), ...base,
      };
    }
    return { type: 'unknown', ...base };
  }

  return { parse, parseWhen, normalize, matchTasks, cleanTitle };
});
