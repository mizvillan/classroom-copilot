const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const HIGH_STAKES =
  /\b(exam|final|midterm|test|quiz|project|essay|presentation|portfolio|lab report|paper|thesis|debate)\b/i;
const LOW_EFFORT =
  /\b(reading|read|discussion|comment|worksheet|practice|check-?in|survey|journal|vocab|watch)\b/i;

export const CATEGORY_LABELS = {
  now: "Do first",
  week: "This week",
  later: "Backlog",
  done: "Turned in",
};

export function humanSpan(ms) {
  const abs = Math.abs(ms);
  if (abs < MINUTE) return "under a minute";
  if (abs < HOUR) {
    const minutes = Math.round(abs / MINUTE);
    return `${minutes} min`;
  }
  if (abs < DAY) {
    const hours = Math.floor(abs / HOUR);
    return `${hours}h`;
  }
  const days = Math.round(abs / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Human wording for a due timestamp, relative to now. */
export function duePhrase(dueAt, now = Date.now()) {
  if (!dueAt) return "No due date";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "No due date";
  const delta = due - now;
  if (delta < 0) {
    if (delta > -6 * HOUR) return "Overdue — due earlier today";
    return `Overdue by ${humanSpan(delta)}`;
  }
  if (delta < MINUTE) return "Due right now";
  if (delta < DAY) return `Due in ${humanSpan(delta)}`;
  return `Due in ${humanSpan(delta)}`;
}

function pointsBonus(points) {
  if (points >= 100) return 14;
  if (points >= 50) return 9;
  if (points >= 20) return 5;
  if (points > 0) return 2;
  return 0;
}

/**
 * Rank is intentionally explainable: urgency first, then stakes, points and
 * submission state. No AI is needed for this part, so the app still gives a
 * correct answer when no model key is configured.
 */
export function computePriority(assignment, now = Date.now()) {
  const due = assignment.dueAt ? new Date(assignment.dueAt) : null;
  const dueMs = due && !Number.isNaN(due.getTime()) ? due.getTime() : null;
  const submitted = Boolean(assignment.submitted);
  const points = Number(assignment.maxPoints) || 0;
  const title = assignment.title || "";
  const reasons = [];
  let score = 0;
  let category = "later";

  if (submitted) {
    score = 4;
    category = "done";
    reasons.push(assignment.late ? "Turned in late" : "Turned in");
  } else if (!dueMs) {
    score = 22;
    category = "later";
    reasons.push("No due date");
  } else {
    const hours = (dueMs - now) / HOUR;
    const days = hours / 24;

    if (hours < 0) {
      score = 140;
      reasons.push(duePhrase(assignment.dueAt, now));
    } else if (hours <= 24) {
      score = 126;
      reasons.push(duePhrase(assignment.dueAt, now));
    } else if (hours <= 48) {
      score = 108;
      reasons.push(duePhrase(assignment.dueAt, now));
    } else if (hours <= 72) {
      score = 98;
      reasons.push(duePhrase(assignment.dueAt, now));
    } else if (days <= 7) {
      score = Math.round(88 - (days - 3) * 6);
      reasons.push(duePhrase(assignment.dueAt, now));
    } else if (days <= 14) {
      score = 45;
      reasons.push(duePhrase(assignment.dueAt, now));
    } else {
      score = 24;
      reasons.push(duePhrase(assignment.dueAt, now));
    }

    score += pointsBonus(points);
    if (points > 0) reasons.push(`${points} pts`);
    if (HIGH_STAKES.test(title)) {
      score += 12;
      reasons.push("High-stakes work");
    } else if (LOW_EFFORT.test(title)) {
      score -= 6;
    }
    if (assignment.late && !submitted) score += 4;

    // Category labels are promises: "this week" must actually be this week,
    // no matter how many points a far-away project is worth.
    if (hours < 0 || hours <= 24) {
      category = "now";
    } else if (hours <= 72) {
      category = score >= 110 ? "now" : "week";
    } else if (days <= 7.5) {
      category = "week";
    } else {
      category = "later";
    }
  }

  return {
    score: Math.max(0, Math.min(190, Math.round(score))),
    category,
    label: CATEGORY_LABELS[category],
    reasons: reasons.slice(0, 3),
  };
}

/** Attach priorities and sort the most pressing work first. */
export function rankAssignments(assignments, now = Date.now()) {
  return assignments
    .map((assignment) => ({
      ...assignment,
      priority: computePriority(assignment, now),
      duePhrase: duePhrase(assignment.dueAt, now),
    }))
    .sort((a, b) => {
      if (a.priority.category === "done" && b.priority.category !== "done") return 1;
      if (b.priority.category === "done" && a.priority.category !== "done") return -1;
      if (a.priority.score !== b.priority.score) {
        return b.priority.score - a.priority.score;
      }
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return String(a.title).localeCompare(String(b.title));
    });
}

function startOfLocalDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function computeStats(assignments, now = Date.now()) {
  const current = new Date(now);
  const dayStart = startOfLocalDay(current);
  const dayEnd = dayStart + DAY;
  const weekEnd = now + 7 * DAY;
  const active = assignments.filter((assignment) => !assignment.submitted);
  const dueMs = (assignment) =>
    assignment.dueAt ? new Date(assignment.dueAt).getTime() : null;

  const overdue = active.filter((assignment) => {
    const due = dueMs(assignment);
    return due !== null && due < now;
  }).length;
  const dueToday = active.filter((assignment) => {
    const due = dueMs(assignment);
    return due !== null && due >= dayStart && due < dayEnd;
  }).length;
  const due48h = active.filter((assignment) => {
    const due = dueMs(assignment);
    return due !== null && due >= now && due <= now + 48 * HOUR;
  }).length;
  const dueWeek = active.filter((assignment) => {
    const due = dueMs(assignment);
    return due !== null && due >= now && due <= weekEnd;
  }).length;
  const pointsThisWeek = active.reduce((sum, assignment) => {
    const due = dueMs(assignment);
    if (due !== null && due >= now && due <= weekEnd) {
      return sum + (Number(assignment.maxPoints) || 0);
    }
    return sum;
  }, 0);
  const done = assignments.length - active.length;
  const newCount = active.filter((assignment) => assignment.isNew).length;

  return {
    total: assignments.length,
    active: active.length,
    overdue,
    dueToday,
    due48h,
    dueWeek,
    done,
    newCount,
    pointsThisWeek,
    completion: assignments.length
      ? Math.round((done / assignments.length) * 100)
      : 0,
  };
}

function lineFor(assignment) {
  const bits = [assignment.courseName, assignment.duePhrase];
  if (assignment.maxPoints) bits.push(`${assignment.maxPoints} pts`);
  return `**${assignment.title}** — ${bits.join(" · ")}`;
}

/**
 * Deterministic briefing used with no AI key, while the model is unreachable,
 * and for Discord scheduled digests. Same structure as the AI prompt asks for.
 */
export function localBriefing(ranked, stats) {
  const active = ranked.filter((assignment) => !assignment.submitted);
  const groups = {
    now: active.filter((assignment) => assignment.priority.category === "now"),
    week: active.filter((assignment) => assignment.priority.category === "week"),
    later: active.filter((assignment) => assignment.priority.category === "later"),
  };
  const focus = active[0];
  const lines = [];

  if (!focus) {
    return "### You're clear\n\nNo open assignments in Classroom right now. Enjoy the gap — or get ahead on something you actually want to do.";
  }

  const pushGroup = (title, items, limit, numbered = false) => {
    if (!items.length) return;
    lines.push(`### ${title}`, "");
    items.slice(0, limit).forEach((assignment, index) => {
      lines.push(
        `${numbered ? `${index + 1}.` : "-"} ${lineFor(assignment)}`,
      );
    });
    lines.push("");
  };

  pushGroup("Do first", groups.now, 4, true);
  pushGroup("This week", groups.week, 6);
  pushGroup("Backlog", groups.later, 5);

  const next = active[1];
  const followUp = next
    ? ` Then pick up **${next.title}** (${next.courseName}, ${next.duePhrase.toLowerCase()}).`
    : "";
  lines.push(
    "### Start now",
    "",
    `Open **${focus.title}** for ${focus.courseName}. ${focus.duePhrase}${
      focus.maxPoints ? `, worth ${focus.maxPoints} points` : ""
    }. Work on it for one focused block before switching tasks.${followUp}`,
    "",
    `_${stats.active} open · ${stats.overdue} overdue · ${stats.dueWeek} due in the next 7 days · ${stats.done} turned in._`,
  );

  return lines.join("\n");
}
