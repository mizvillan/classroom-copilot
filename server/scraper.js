/**
 * Cookie-based Google Classroom reader.
 *
 * The school's Workspace-for-Education admin blocks third-party OAuth for
 * under-18 accounts, so the official API is unreachable. The web app itself
 * still answers, though: these helpers load the To-do pages the same browser
 * session sees and pull the assignments out of the page's embedded data.
 *
 * Configure with the browser cookie header for an open
 * classroom.google.com session: CLASSROOM_COOKIES in .env (or a file via
 * CLASSROOM_COOKIE_FILE). Nothing is evaled from the page — the data
 * extractor is a small, strict parser, so a hostile assignment title can
 * never execute code.
 */

import { config } from "./config.js";
import { AppError } from "./errors.js";

export function scraperConfigured() {
  return Boolean(config.classroom.cookies);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const PAGES = [
  { name: "Assigned", url: "https://classroom.google.com/u/0/a/not-turned-in/all" },
  { name: "Missing", url: "https://classroom.google.com/u/0/a/missing/all" },
];
const HOME_URL = "https://classroom.google.com/u/0/r/home";

function cookieHeader(extra = "") {
  const parts = [config.classroom.cookies, extra].filter(Boolean);
  return parts.join("; ").replace(/;+\s*$/, "");
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Cookie: cookieHeader(),
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "classroom_cookies_expired",
      "Classroom rejected the saved cookies — copy a fresh Cookie header from an open Classroom tab.",
      401,
    );
  }
  if (response.url.includes("accounts.google.") || response.url.includes("ServiceLogin")) {
    throw new AppError(
      "classroom_cookies_expired",
      "The cookie session was logged out — copy a fresh Cookie header from an open Classroom tab.",
      401,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "classroom_scrape_unreachable",
      `Classroom returned ${response.status} for the To-do page.`,
      502,
    );
  }
  return response.text();
}

/** Extract the argument of every AF_initDataCallback(...) on the page. */
function extractDataBlocks(html) {
  const blocks = [];
  const marker = "AF_initDataCallback(";
  let cursor = 0;
  // Robust for minified pages: find each callback start, then pull the
  // balanced "data:" payload with a bracket scanner that respects strings.
  while (cursor < html.length) {
    const start = html.indexOf(marker, cursor);
    if (start < 0) break;
    const dataKey = html.indexOf("data:", start);
    const end = html.indexOf(");", Math.max(dataKey, start));
    if (dataKey < 0 || end < 0 || dataKey > end) {
      cursor = start + marker.length;
      continue;
    }
    const payload = extractBalanced(html, dataKey + 5, end);
    if (payload) {
      const parsed = parseJsLiteral(payload);
      if (parsed !== undefined) blocks.push(parsed);
    }
    cursor = end + 2;
  }
  return blocks;
}

/** Grab a balanced [...] / {...} slice starting at `from`, stopping safely. */
function extractBalanced(text, from, hardStop) {
  let depth = 0;
  let start = -1;
  let index = from;
  let inString = false;
  let quote = "";
  let escaped = false;
  while (index < Math.min(hardStop + 200_000, text.length)) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    } else if (char === "[" || char === "{") {
      if (start < 0) start = index;
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth <= 0 && start >= 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return null;
}

/**
 * Parse a JS array literal without eval. Supports double/single-quoted
 * strings, numbers, true/false/null and nested arrays/objects — the subset
 * Chrome's embedded Wiz data uses.
 */
function parseJsLiteral(literal) {
  try {
    let cursor = 0;

    const skip = () => {
      while (cursor < literal.length && /\s/.test(literal[cursor])) cursor += 1;
    };

    const readString = (quote) => {
      const out = [];
      cursor += 1;
      while (cursor < literal.length) {
        const char = literal[cursor];
        if (char === "\\") {
          const next = literal[cursor + 1];
          const escapes = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
          if (escapes[next] !== undefined) out.push(escapes[next]);
          else if (next === "u" && /[0-9a-f]{4}/i.test(literal.slice(cursor + 2, cursor + 6))) {
            out.push(String.fromCharCode(Number.parseInt(literal.slice(cursor + 2, cursor + 6), 16)));
            cursor += 4;
          } else if (next === quote || next === "\\" || next === "/") out.push(next);
          else out.push(next);
          cursor += 2;
          continue;
        }
        if (char === quote) {
          cursor += 1;
          return out.join("");
        }
        out.push(char);
        cursor += 1;
      }
      throw new Error("unterminated string");
    };

    const readValue = () => {
      skip();
      const char = literal[cursor];
      if (char === '"' || char === "'") return readString(char);
      if (char === "[") {
        cursor += 1;
        const array = [];
        skip();
        if (literal[cursor] === "]") {
          cursor += 1;
          return array;
        }
        for (;;) {
          array.push(readValue());
          skip();
          if (literal[cursor] === ",") {
            cursor += 1;
            skip();
            if (literal[cursor] === "]") {
              cursor += 1;
              return array;
            }
            continue;
          }
          if (literal[cursor] === "]") {
            cursor += 1;
            return array;
          }
          throw new Error(`bad array at ${cursor}`);
        }
      }
      if (char === "{") {
        cursor += 1;
        const object = {};
        skip();
        if (literal[cursor] === "}") {
          cursor += 1;
          return object;
        }
        for (;;) {
          skip();
          const keyRaw = literal[cursor];
          let key;
          if (keyRaw === '"' || keyRaw === "'") key = readString(keyRaw);
          else {
            const match = /^[\w$]+/.exec(literal.slice(cursor));
            if (!match) throw new Error(`bad key at ${cursor}`);
            key = match[0];
            cursor += match[0].length;
          }
          skip();
          if (literal[cursor] !== ":") throw new Error(`bad object at ${cursor}`);
          cursor += 1;
          object[key] = readValue();
          skip();
          if (literal[cursor] === ",") {
            cursor += 1;
            continue;
          }
          if (literal[cursor] === "}") {
            cursor += 1;
            return object;
          }
          throw new Error(`bad object at ${cursor}`);
        }
      }
      const numberMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(literal.slice(cursor));
      if (numberMatch) {
        cursor += numberMatch[0].length;
        return Number(numberMatch[0]);
      }
      if (literal.startsWith("true", cursor)) {
        cursor += 4;
        return true;
      }
      if (literal.startsWith("false", cursor)) {
        cursor += 5;
        return false;
      }
      if (literal.startsWith("null", cursor)) {
        cursor += 4;
        return null;
      }
      if (literal.startsWith("void", cursor) || literal.startsWith("new", cursor)) {
        throw new Error("unsupported token");
      }
      throw new Error(`unexpected token at ${cursor}`);
    };

    const value = readValue();
    return value;
  } catch {
    return undefined;
  }
}

function isDateArray(node) {
  if (!Array.isArray(node)) return false;
  if (node.length < 3 || node.length > 5) return false;
  const [y, m, d, h = 0, min = 0] = node;
  if (!Number.isInteger(y) || y < 2020 || y > 2040) return false;
  if (!Number.isInteger(m) || m < 0 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  if (!Number.isInteger(h) || h < 0 || h > 23) return false;
  if (!Number.isInteger(min) || min < 0 || min > 59) return false;
  // Reject arrays that are really plain numbers in disguise, like [2024, 11, 5]
  // used as a counter triple — due dates for coursework legitimately match,
  // and false positives are cheap here.
  return true;
}

function dueIso(dateArray) {
  const [y, m, d, h = 9, min = 0] = dateArray;
  // Classroom mixes 1-indexed months in its proto payload and 0-indexed
  // Calendar-style months elsewhere; m===12 can only mean December.
  const month = m === 12 ? 12 : m >= 1 && m <= 12 ? m : m + 1;
  const date = new Date(y, month - 1, d, h, min, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const JUNK_STRING =
  /^([0-9a-f-]{16,}|[-_A-Za-z0-9+/]{40,}=*|\d{6,}|https?:\/\/|[^\s]*\.google\.com|\d{1,4}\s*points?|missing|turned in|assigned\b)/i;

function plausibleText(value) {
  if (typeof value !== "string") return false;
  return value.length >= 3 && value.length <= 220 && !JUNK_STRING.test(value);
}

/**
 * Walk the parsed page data in document order and pull out coursework
 * candidates: a due-date array plus sibling strings. Titles, courses and
 * points land in one pass, so the result is best-effort by design — the paste
 * importer is the fallback when a page shape beats this heuristic.
 */
export function extractAssignments(blocks, courseNames = new Set()) {
  const items = [];
  const seen = new Set();

  const walk = (node, context) => {
    if (Array.isArray(node)) {
      const dates = node.filter(isDateArray);
      const strings = collectStrings(node, new Set());
      if (dates.length) {
        const title = strings.find((value) => plausibleText(value) && !courseNames.has(value.toLowerCase()));
        if (title) {
          const due = dates[0];
          const points = strings
            .map((value) => /(\d{1,4})\s*points?/i.exec(value))
            .filter(Boolean)
            .map((match) => Number(match[1]))
            .find((points) => points > 0);
          const course =
            strings.find((value) => courseNames.has(value.toLowerCase())) || context || "";
          const key = `${course.toLowerCase()}|${title.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push({
              title,
              courseName: course || "(No course)",
              dueAt: dueIso(due),
              maxPoints: typeof points === "number" ? points : null,
            });
          }
          return true;
        }
      }
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, context);
    } else if (node && typeof node === "object") {
      for (const child of Object.values(node)) walk(child, context);
    }
    return false;
  };

  for (const block of blocks) walk(block, "");

  return items;
}

function collectStrings(node, seenNodes) {
  const strings = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.shift();
    if (seenNodes.has(current)) continue;
    seenNodes.add(current);
    if (typeof current === "string") strings.push(current);
    else if (Array.isArray(current)) for (const child of current) stack.push(child);
    else if (current && typeof current === "object") for (const child of Object.values(current)) stack.push(child);
  }
  return strings.filter(plausibleText);
}

/** Course cards on the home page: [numeric id, name, ...] entities. */
function extractCourseNames(blocks) {
  const names = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) {
      const idIndex = node.findIndex(
        (child) => typeof child === "string" && /^\d{9,}$/.test(child),
      );
      if (idIndex >= 0) {
        for (let offset = 1; offset <= 3 && idIndex + offset < node.length; offset += 1) {
          const candidate = node[idIndex + offset];
          if (
            typeof candidate === "string" &&
            candidate.length >= 3 &&
            candidate.length <= 80 &&
            !JUNK_STRING.test(candidate) &&
            !/^\d+$/.test(candidate)
          ) {
            names.add(candidate.trim().toLowerCase());
            break;
          }
        }
      }
      for (const child of node) walk(child);
    } else if (node && typeof node === "object") {
      for (const child of Object.values(node)) walk(child);
    }
  };
  for (const block of blocks) walk(block);
  return names;
}

/**
 * Fire the full scrape: course names from the home page, then the Assigned
 * and Missing To-do pages. Returns items ready for mergeImport.
 */
export async function scrapeClassroom() {
  if (!scraperConfigured()) {
    throw new AppError(
      "classroom_no_cookies",
      "Set CLASSROOM_COOKIES in .env to enable Classroom auto-sync.",
      400,
    );
  }

  const warnings = [];
  let courseNames = new Set();
  try {
    const homeHtml = await fetchPage(HOME_URL);
    courseNames = extractCourseNames(extractDataBlocks(homeHtml));
  } catch (error) {
    if (error?.code === "classroom_cookies_expired") throw error;
    warnings.push("Courses page could not be read; items may miss course names.");
  }

  const items = [];
  for (const page of PAGES) {
    try {
      const html = await fetchPage(page.url);
      const blocks = extractDataBlocks(html);
      const found = extractAssignments(blocks, courseNames);
      if (found.length) items.push(...found.map((item) => ({ ...item, source: page.name.toLowerCase() })));
    } catch (error) {
      if (error?.code === "classroom_cookies_expired") throw error;
      warnings.push(`${page.name}: ${error.code === "classroom_scrape_unreachable" ? error.message : "could not be read"}`);
    }
  }

  return { items, warnings };
}
