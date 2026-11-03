/**
 * Paste-import parser.
 *
 * Turns copied text from the Classroom web app (or any hand-typed list) into
 * draft assignments. It accepts several layouts because nobody is going to
 * reformat their To-do page: title-first cards, "Due Tomorrow"-first cards and
 * plain one-line dumps. Anything it can't confidently parse still surfaces as
 * a draft row the user can fix in the import wizard before saving.
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_PATTERN = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const WEEKDAY_PATTERN = "sun(day)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?";

const JUNK_LINE =
  /^(show( all)?|to-?do|assigned|missing|missing|notifications?|classroom|google classroom|calend(a|ur)|workload|nav(igation)?|menu|search|settings|workspace|all courses|no (work|items)|nothing here|reset|clear( all)?|cancel|save|delete|edit|add|close|open|details|comments?|private|posted|share|term|side panel|announcements?|upcoming|this week|later|overdue|today|tomorrow|skip to main content|main menu|archived classes|all (classes|items|work)|collapse|expand|done|done \d+|out(standing)?|in\s*box|subject|section)\b[.!…]*$/i;

// Google UI furniture that shows up in the rendered To-do text: icon names,
// "Posted Friday, Apr 17" metadata chips, tiny section labels like "9O,9P".
const UI_JUNK =
  /(^posted\b.{0,60}$|^keyboard_arrow\w*$|^[A-Za-z0-9]{1,3},[A-Za-z0-9]{1,3}$|^assignment$|^announcement$|^help and feedback$|^screen reader support enabled\.?$)/i;

const DUE_LINE = /^(?:due(?:\s*by)?|dUE)\s*[:\-]?\s*(.+)$/i;
const NO_DUE_LINE = /^no due date\b/i;
const POINTS_LINE = /^(?:(\d+)\s*\/\s*(\d+)|(\d+)\s*(?:points?|pts))\.?$/i;
const TURNED_IN_LINE = /^turned in\b.*$/i;
const COURSE_SUFFIX = /(?:\(?\s*(?:period|sec(?:tion)?|block|room|p)\s*[\dA-Za-z]+\)?\s*)?$/i;

const DAY = 86_400_000;

function dueDateFromPhrase(phrase, now) {
  const text = String(phrase ?? "")
    .toLowerCase()
    .replace(/^[•\-*\s]+/, "")
    .replace(/[.,;:]+$/, "")
    .trim();
  if (!text || text === "none") return null;

  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = timeFromPhrase(text);
  const withTime = (date) => {
    if (time) date.setHours(time.hours, time.minutes, 0, 0);
    else date.setHours(23, 59, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  if (/today|tonight/.test(text)) return withTime(new Date(dayStart));
  if (/tomorrow/.test(text)) return withTime(new Date(dayStart + DAY));
  if (/next week\b/.test(text)) return withTime(new Date(dayStart + 7 * DAY));
  if (/yesterday/.test(text)) return withTime(new Date(dayStart - DAY));

  const monthFirst = text.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i"),
  );
  const dayFirst = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\.?(?:,?\\s+(\\d{4}))?`, "i"),
  );

  let month = null;
  let day = null;
  let year = null;
  let matched = null;
  if (monthFirst) {
    matched = monthFirst;
    month = monthIndex(matched[1]);
    day = Number(matched[2]);
    year = matched[3] ? Number(matched[3]) : null;
  } else if (dayFirst) {
    matched = dayFirst;
    day = Number(matched[1]);
    month = monthIndex(dayFirst[2]);
    year = dayFirst[3] ? Number(dayFirst[3]) : null;
  }

  if (month && day && day >= 1 && day <= 31) {
    const currentYear = today.getFullYear();
    if (!year) {
      const candidate = new Date(currentYear, month - 1, day);
      if (candidate.getTime() < dayStart - 14 * DAY) year = currentYear + 1;
    }
    return withTime(new Date(year ?? currentYear, month - 1, day));
  }

  // Weekday-only phrases ("Due Tuesday") resolve to the nearest such day.
  // Checked after explicit dates so "Tuesday, Apr 14" keeps its own month/day.
  const weekday = text.match(new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, "i"));
  if (weekday) {
    const token = weekday[0].toLowerCase().replace(/[^a-z]/g, "");
    const target = WEEKDAYS[token];
    if (target !== undefined) {
      const delta = (target - new Date(dayStart).getDay() + 7) % 7;
      return withTime(new Date(dayStart + delta * DAY));
    }
  }

  return null;
}

function monthIndex(name) {
  const key = name.toLowerCase().slice(0, 3);
  return MONTHS[key] ?? null;
}

/** "11:59 PM", "8:15 am", "17:30", "noon" -> { hours, minutes } | null. */
function timeFromPhrase(text) {
  if (/noon/.test(text)) return { hours: 12, minutes: 0 };
  if (/midnight/.test(text)) return { hours: 23, minutes: 59 };

  const meridiem = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (meridiem) {
    let hours = Number(meridiem[1]) % 12;
    if (meridiem[3].toLowerCase().startsWith("p")) hours += 12;
    return { hours, minutes: Number(meridiem[2] || 0) };
  }

  const military = text.match(/\b([01]?\d|2[0-3]):(\d{2})\b/);
  if (military) {
    return { hours: Number(military[1]), minutes: Number(military[2]) };
  }

  return null;
}

function isJunk(line) {
  const value = line.trim();
  return (
    value.length < 2 ||
    JUNK_LINE.test(value) ||
    UI_JUNK.test(value) ||
    /^[\d\s]+$/.test(value) ||
    /^[-•*·—–]+$/.test(value) ||
    /^v?\d+\.\d+(\.\d+)?$/.test(value)
  );
}

function looksLikeCourse(line) {
  const value = line.trim().replace(COURSE_SUFFIX, "").trim();
  if (value.length < 2 || value.length > 60) return false;
  // Sentences with instruction verbs or punctuation are titles, not courses.
  if (/[,;:?!]/.test(value)) return false;
  if (/\b(chapters?|pages?|questions?|problems?|paragraphs?|essay|exercise|worksheet|slides|submit|read|readings?|study|write|memoris|memoriz|practise|practice|vocab(?:ulary)?|design|draw|solve|finish|complete|report|draft|assignment|homework)\b/i.test(value)) {
    return false;
  }
  const words = value.split(/\s+/);
  if (words.length > 7) return false;
  const allCapitalised = words.every(
    (word) => /^[A-Z0-9&/().–—+\-'’:%]/.test(word) || word.length <= 4,
  );
  // A single PascalCase word with two humps ("HumanGeo") is a course;
  // a lowercase concatenation of an ordinary phrase ("Labreportdraft") is not.
  const singlePascal =
    words.length === 1 && /^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(value);
  return allCapitalised || singlePascal;
}

function looksLikeTitle(line) {
  const value = line.trim();
  if (value.length < 3 || value.length > 220) return false;
  if (isJunk(value)) return false;
  if (/^\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?$/i.test(value)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return true;
}

function normaliseTitle(value) {
  return value
    .replace(/^[-•*\s]+/, "")
    .replace(/\s*\(due.*$/i, "")
    .trim()
    .slice(0, 200);
}

/**
 * Parse a pasted block of text into draft assignments.
 */
export function parsePaste(text, now = Date.now()) {
  const raw = String(text ?? "").replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Tab-separated rows (spreadsheet copy / "title\tcourse\tdue" style).
  if (lines.length === 1 && lines[0].includes("\t")) {
    const drafts = lines[0]
      .split(/\t+/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => draftFromLine(row, now));
    return finish(drafts, lines);
  }

  const drafts = [];
  const dropped = [];

  let currentCourse = "";
  let pendingCourse = "";
  let pendingTitle = "";
  let pendingDue = null;
  let pendingPoints = null;
  let pendingDone = false;
  let pendingMissing = false;

  const flushPending = () => {
    if (!pendingTitle) return reset();
    const dueAt = pendingDue && !Number.isNaN(new Date(pendingDue).getTime()) ? pendingDue : null;
    drafts.push({
      title: normaliseTitle(pendingTitle),
      courseName: (pendingCourse || currentCourse || "").trim() || "(No course)",
      dueAt,
      maxPoints: Number.isFinite(pendingPoints) ? pendingPoints : null,
      submitted: pendingDone,
      missing: pendingMissing,
    });
    reset();
  };

  const reset = () => {
    pendingTitle = "";
    pendingDue = null;
    pendingPoints = null;
    pendingDone = false;
    pendingMissing = false;
  };

  // Apply a status flag to the pending row, or retroactively to the last
  // flushed row when the label trails it ("... \n Missing").
  const flagLast = (flag) => {
    if (drafts.length) {
      const last = drafts[drafts.length - 1];
      drafts[drafts.length - 1] = { ...last, [flag]: true };
    }
  };

  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;

    // Header lines reset the current course (a new section starts).
    const dueMatch = value.match(DUE_LINE);
    if (dueMatch) {
      const phrase = dueMatch[1];
      const inlinePoints = /(\d{1,4})\s*(?:points?|pts)\b/i.exec(phrase);
      if (inlinePoints) pendingPoints = Number(inlinePoints[1]);
      const parsedDue = dueDateFromPhrase(phrase, now);
      if (pendingTitle) {
        // Bind the due to the row we were building, then flush it.
        if (parsedDue) pendingDue = parsedDue;
        flushPending();
      } else {
        // Due-first card: hold until the title arrives.
        pendingDue = parsedDue;
      }
      continue;
    }

    // A bare date chip with no "Due" prefix — the Classroom To-do cards end
    // with the date alone ("Tuesday, Apr 14"), not a sentence.
    if (/^[A-Za-z]{5,9}day\s*,|^[A-Za-z]{3,9}\s+\d{1,2}\b|^\d{1,2}\s+[A-Za-z]{3,9}\b/.test(value)) {
      const parsedChip = dueDateFromPhrase(value, now);
      if (parsedChip) {
        if (pendingTitle) {
          pendingDue = parsedChip;
          flushPending();
        } else {
          pendingDue = parsedChip;
        }
        continue;
      }
      // Date-shaped but unparseable — never let it become a fake title.
      continue;
    }

    if (NO_DUE_LINE.test(value)) {
      flushPending();
      pendingDue = null;
      continue;
    }

    const pointsMatch = value.match(POINTS_LINE);
    if (pointsMatch) {
      if (!pendingTitle) {
        // A points line before the title binds to whatever title follows.
        pendingPoints = Number(pointsMatch[3] ?? pointsMatch[2] ?? pointsMatch[1]);
        continue;
      }
      pendingPoints = Number(pointsMatch[3] ?? pointsMatch[2] ?? pointsMatch[1]);
      flushPending();
      continue;
    }

    if (TURNED_IN_LINE.test(value)) {
      if (pendingTitle) {
        pendingDone = true;
        flushPending();
      } else {
        flagLast("submitted");
      }
      continue;
    }

    if (/^miss(ing|ed)\b/i.test(value)) {
      if (pendingTitle) {
        flushPending();
        pendingMissing = true;
        const rest = value.replace(/^miss(?:ing|ed)\b[:\-\s]*/, "");
        if (rest && !/not yet/i.test(rest)) {
          const parsed = dueDateFromPhrase(rest, now);
          if (parsed) pendingDue = parsed;
        }
      } else {
        flagLast("missing");
      }
      continue;
    }

    if (isJunk(value)) {
      if (pendingTitle) flushPending();
      continue;
    }

    const isCourse = looksLikeCourse(value);
    if (isCourse && !pendingTitle) {
      currentCourse = value;
      pendingCourse = value;
      continue;
    }

    if (!pendingTitle && looksLikeTitle(value)) {
      pendingTitle = value;
      if (!pendingCourse && currentCourse) pendingCourse = currentCourse;
      continue;
    }

    if (pendingTitle && isCourse) {
      // The previous card was title-only; this line opens the next.
      flushPending();
      // Classroom To-do cards name their course AFTER the title, so the card
      // just flushed is the one this course line belongs to.
      if (drafts.length && drafts[drafts.length - 1].courseName === "(No course)") {
        drafts[drafts.length - 1] = { ...drafts[drafts.length - 1], courseName: value };
      }
      currentCourse = value;
      pendingCourse = value;
      continue;
    }

    if (pendingTitle) {
      flushPending();
      pendingTitle = value;
      pendingCourse = currentCourse;
      continue;
    }

    // Anything unreachable lands here as a course-less draft row.
    const standalone = draftFromLine(value, now);
    drafts.push(standalone);
  }

  flushPending();

  if (!drafts.length) {
    for (const line of lines) {
      if (isJunk(line)) dropped.push(line);
    }
  }

  return finish(drafts, lines);
}

function draftFromLine(line, now) {
  const dueMatch = line.match(DUE_LINE);
  const pointsMatch = line.match(POINTS_LINE);
  const missing = /miss(ing|ed)\b/i.test(line);
  return {
    title: normaliseTitle(
      (dueMatch ? line.replace(DUE_LINE, "$1") : line)
        .replace(POINTS_LINE, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    ),
    courseName: "(No course)",
    dueAt: dueMatch ? dueDateFromPhrase(dueMatch[1], now) : null,
    maxPoints: pointsMatch ? Number(pointsMatch[3] ?? pointsMatch[2] ?? pointsMatch[1]) : null,
    submitted: false,
    missing,
  };
}

function finish(drafts, lines) {
  const seen = new Set();
  const unique = drafts.filter((draft) => {
    const key = `${draft.courseName.toLowerCase()}|${draft.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { drafts: unique, dropped: [] };
}
