/**
 * Browser-backed Google Classroom reader.
 *
 * Server-side fetches of the To-do pages return an empty JS shell — Classroom
 * loads its data only after the web app starts running, and its internal API
 * rejects calls that don't look like the app itself. So we do what the browser
 * does: launch a real (locally installed, normally headless) Edge or Chrome,
 * keep its profile on disk so the Google session survives and rotates its own
 * cookies, navigate exactly like a user would, wait for the lists to render,
 * then read the visible text and feed it through the same parser the paste
 * importer uses.
 *
 * Session ownership (in order):
 *   1. The persistent browser profile — after it signs in once, it keeps its
 *      own cookies alive indefinitely (Google rotates them transparently).
 *   2. CLASSROOM_COOKIES / CLASSROOM_COOKIE_FILE — used as one-time starter
 *      seed, and copied into the profile on the first successful page.
 *
 * Nothing from the page is eval'd. The browser is driven by locators; the
 * text that comes back is parsed, never executed.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { parsePaste } from "./parser.js";

const HOME_URL = "https://classroom.google.com/u/0/r/home";
const PAGES = [
  { name: "assigned", url: "https://classroom.google.com/u/0/a/not-turned-in/all" },
  { name: "missing", url: "https://classroom.google.com/u/0/a/missing/all" },
];
const LOGIN_HINT = /accounts\.google\.[^/]+\/v3\/signin|ServiceLogin|\/BadgeLogin/;

/** Browser mode can be turned off with CLASSROOM_BROWSER=off. */
export function harvestEnabled() {
  return (
    Boolean(config.classroom.cookies || fs.existsSync(profileDir())) &&
    config.classroom.browser !== "off"
  );
}

function profileDir() {
  return config.classroom.profileDir || path.join(config.dataDir, "browser-profile");
}

/** The saved cookie header -> Playwright cookie objects for .google.com. */
function cookieJar() {
  return String(config.classroom.cookies)
    .split(/;\s*/)
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 1) return null;
      return {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      };
    })
    .filter(Boolean);
}

function channelsToTry() {
  const preferred = String(config.classroom.browser || "").toLowerCase();
  if (preferred === "msedge" || preferred === "chrome") return [preferred];
  // Edge first (ships with Windows), Chrome as backup.
  return ["msedge", "chrome"];
}

/**
 * The login command opens the SAME persistent profile headfully, so whatever
 * the user signs into from that window keeps running headlessly afterwards.
 */
export async function launchPersistentForLogin(headless) {
  let lastError = null;
  for (const channel of channelsToTry()) {
    try {
      return await chromium.launchPersistentContext(profileDir(), {
        channel,
        headless,
        viewport: headless ? { width: 1280, height: 900 } : null,
        args: ["--no-first-run"],
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new AppError(
    "classroom_browser_unavailable",
    "No Edge/Chrome found for the browser sync. Install Edge or Chrome, or set CLASSROOM_BROWSER=off to use paste import.",
    500,
    lastError?.message,
  );
}

/**
 * Does the profile already carry a Google login (any SID family cookie)?
 * Kept cheap: read the cookie names eagerly when the context opens.
 */
function hasAccountCookie(cookies) {
  return cookies.some((cookie) => /^(SID|HSID|SSID|SAPISID|__Secure-1PSID|__Secure-3PSID)$/.test(cookie.name));
}

/** Guard against session loss: a signed-out Classroom lands on Google login. */
function assertSignedIn(page, signupUrl = false) {
  if (LOGIN_HINT.test(page.url())) {
    throw new AppError(
      "classroom_cookies_expired",
      "The browser profile lost its Classroom session. Run `npm run classroom-login` once and sign in — after that the profile stays logged in automatically. (Or paste fresh cookies in .env as CLASSROOM_COOKIES.)",
      401,
    );
  }
}

/** Course names come from the home page's real course links. */
async function readCourseNames(page) {
  const names = await page.$$eval('a[href*="/c/"]', (links) => {
    const out = [];
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 12) continue;
      const first = String(link.innerText || "")
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part.length >= 3 && part.length <= 80);
      if (first) out.push(first);
    }
    return out;
  });
  return [...new Set(names.filter(Boolean))];
}

/**
 * The full harvest: home (course names), Assigned, Missing. Returns
 * { items, warnings } with parser drafts ready for applyImport. An empty
 * To-do is a legitimate result — items: [] and no warning.
 */
export async function harvestClassroom() {
  const warnings = [];
  const items = [];
  const context = await launchPersistentForLogin(true);

  try {
    if (config.classroom.cookies && !hasAccountCookie(await context.cookies("https://classroom.google.com"))) {
      await context.addCookies(cookieJar());
    }
    const page = await context.newPage();
    let signedIn = false;

    // Course names from the dashboard, best effort.
    let courseNames = new Set();
    try {
      await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      assertSignedIn(page);
      signedIn = true;
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      assertSignedIn(page);
      courseNames = new Set((await readCourseNames(page)).map((name) => name.toLowerCase()));
    } catch (error) {
      if (error?.code === "classroom_cookies_expired") throw error;
      warnings.push("Course list could not be read; items may miss course names.");
    }

    if (signedIn) {
      for (const entry of PAGES) {
        try {
          await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          assertSignedIn(page);
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(1_500);
          assertSignedIn(page);

          const text = await page.evaluate(() =>
            String(document.body?.innerText || "").replace(/\u00a0/g, " "),
          );
          const { drafts } = parsePaste(text);
          const decorated = drafts.map((draft) => ({
            ...draft,
            missing: entry.name === "missing" ? true : Boolean(draft.missing),
            source: entry.name,
          }));
          items.push(...decorated);
        } catch (error) {
          if (error?.code === "classroom_cookies_expired") throw error;
          warnings.push(`${entry.name}: ${error?.message || "could not be read"}`);
        }
      }
    }

    await page.close().catch(() => {});
  } finally {
    // Persistent profile: closing the context saves its (rotated) cookies.
    await context.close().catch(() => {});
  }

  return { items, warnings };
}
