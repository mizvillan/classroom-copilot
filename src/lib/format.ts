const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function longDate(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function shortDate(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function exactDue(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function span(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MINUTE) return "under a minute";
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}m`;
  if (abs < DAY) {
    const hours = Math.floor(abs / HOUR);
    const minutes = Math.round((abs % HOUR) / MINUTE);
    return minutes > 0 && hours < 6 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.round(abs / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

export type DueTone = "danger" | "warn" | "soon" | "calm" | "muted";

export function dueMeta(
  iso: string | null,
  now = Date.now(),
): { label: string; exact: string; tone: DueTone } {
  if (!iso) {
    return { label: "No due date", exact: "No due date", tone: "muted" };
  }
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) {
    return { label: "No due date", exact: "No due date", tone: "muted" };
  }
  const delta = due - now;
  const exact = exactDue(iso);
  if (delta < 0) {
    return {
      label: `Overdue ${span(delta)}`,
      exact,
      tone: "danger",
    };
  }
  if (delta < HOUR) {
    return { label: `Due in ${Math.max(1, Math.round(delta / MINUTE))}m`, exact, tone: "danger" };
  }
  if (delta < DAY) {
    return { label: `Due in ${span(delta)}`, exact, tone: "warn" };
  }
  if (delta <= 3 * DAY) {
    return { label: `Due in ${span(delta)}`, exact, tone: "soon" };
  }
  return { label: `Due in ${span(delta)}`, exact, tone: "calm" };
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const delta = now - then;
  if (delta < 45_000) return "just now";
  if (delta < HOUR) return `${Math.round(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.round(delta / DAY)}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function initials(name?: string | null): string {
  if (!name) return "CC";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "CC";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function courseAbbr(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word && word.toLowerCase() !== "ap" && word.toLowerCase() !== "ib");
  const source = words.length ? words : name.split(/\s+/);
  if (source.length === 1) return source[0].slice(0, 3).toUpperCase();
  return source
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm || `${singular}s`;
}

export function typeLabel(type: string): string {
  if (type === "SHORT_ANSWER_QUESTION") return "Short answer";
  if (type === "MULTIPLE_CHOICE_QUESTION") return "Multiple choice";
  return "Assignment";
}

/** Split "2026-11-05T23:59:00.000Z" into a stable local day key. */
export function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
