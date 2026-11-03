import { OAuth2Client } from "google-auth-library";

import { config } from "./config.js";
import { AppError } from "./errors.js";
import { harvestEnabled } from "./harvest.js";
import { scraperConfigured, scrapeClassroom } from "./scraper.js";
import { cacheStore, tokenStore } from "./store.js";
import { computeStats, rankAssignments } from "./priority.js";

const API = "https://classroom.googleapis.com/v1";
const NEW_WINDOW_MS = 72 * 60 * 60 * 1000;
const SUBMISSION_TTL_MS = 12 * 60 * 60 * 1000;
const COURSE_COLORS = [
  "#7ee0a3",
  "#7fc9ff",
  "#ffc46b",
  "#ff9aa8",
  "#c0a6ff",
  "#c7f56d",
  "#f6a6ff",
  "#9bd0ff",
];

let inFlightSync = null;

export function oauthConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function redirectUriFor(origin) {
  return (
    config.google.redirectUri ||
    `${String(origin || `http://localhost:${config.port}`).replace(/\/+$/, "")}/api/auth/google/callback`
  );
}

function createOAuthClient(origin) {
  if (!oauthConfigured()) {
    throw new AppError(
      "google_not_configured",
      "Google sign-in is not configured yet.",
      400,
      "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.",
    );
  }
  return new OAuth2Client(
    config.google.clientId,
    config.google.clientSecret,
    redirectUriFor(origin),
  );
}

export function createAuthUrl(origin, state) {
  const client = createOAuthClient(origin);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: config.google.scopes,
    state,
  });
}

async function fetchProfile(accessToken) {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      name: data.name || "",
      givenName: data.given_name || "",
      email: data.email || "",
      picture: data.picture || "",
    };
  } catch {
    return null;
  }
}

export async function exchangeCode(code, origin) {
  const client = createOAuthClient(origin);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new AppError("google_auth_failed", "Google did not return an access token.", 400);
  }
  const profile = await fetchProfile(tokens.access_token);
  await tokenStore.write({ tokens, profile });
  // A different account must never inherit the previous snapshot.
  await cacheStore.write({
    ...(await cacheStore.read()),
    courses: [],
    assignments: [],
    submissions: {},
    knownIds: [],
    fetchedAt: null,
    briefing: null,
    syncError: null,
  });
  return profile;
}

export async function connection() {
  const [{ tokens, profile }, cache] = await Promise.all([tokenStore.read(), cacheStore.read()]);
  const imported = Boolean(cache.fetchedAt && (cache.assignments || []).length);
  return {
    connected: Boolean(tokens?.access_token || tokens?.refresh_token) || imported,
    imported,
    source: tokens?.access_token || tokens?.refresh_token ? "google" : imported ? "import" : "none",
    profile: imported && !profile ? { name: "Imported data" } : profile || null,
  };
}

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unknown";

/**
 * Merge draft assignments (from the paste importer or the cookie scraper)
 * into the cache. Existing items are updated in place; only items that were
 * never seen before become "new" so alerts stay meaningful.
 */
export async function applyImport(drafts, { source = "import" } = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cache = await cacheStore.read();
  const previousById = new Map(
    (cache.assignments || []).map((assignment) => [assignment.id, assignment]),
  );
  const previouslyKnown = new Set(cache.knownIds || []);
  const firstSync = previouslyKnown.size === 0;

  const courses = new Map(
    (cache.courses || []).map((course) => [course.id, { ...course }]),
  );
  const assignments = new Map(
    (cache.assignments || []).map((assignment) => [assignment.id, { ...assignment }]),
  );
  const newAssignments = [];

  for (const draft of drafts) {
    const title = String(draft.title || "").trim().slice(0, 200);
    if (!title) continue;
    const courseName = (String(draft.courseName || "").trim() || "(No course)").slice(0, 80);
    const courseId = `import:${slug(courseName)}`;
    const id = `${courseId}:${slug(title)}`;

    if (!courses.has(courseId)) {
      courses.set(courseId, {
        id: courseId,
        name: courseName,
        section: source === "scraper" ? "Google Classroom" : "Imported",
        room: "",
        descriptionHeading: "",
        ownerId: "",
        alternateLink: "",
        color: courseColor(courseId),
      });
    }

    const existing = previousById.get(id);
    const isNew = !firstSync && !previouslyKnown.has(id);
    const discoveredAt = isNew ? nowIso : existing?.discoveredAt || null;
    const stillNew = discoveredAt
      ? now - new Date(discoveredAt).getTime() < NEW_WINDOW_MS
      : false;

    const submitted = Boolean(draft.submitted);
    const item = {
      id,
      courseworkId: id,
      courseId,
      courseName,
      courseSection: courses.get(courseId).section,
      courseColor: courses.get(courseId).color,
      title,
      description: existing?.description || "",
      type: "ASSIGNMENT",
      state: "PUBLISHED",
      dueAt: draft.dueAt || null,
      maxPoints:
        typeof draft.maxPoints === "number" && draft.maxPoints > 0
          ? draft.maxPoints
          : existing?.maxPoints || null,
      alternateLink: existing?.alternateLink || "",
      materials: existing?.materials || [],
      topicId: "",
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      submitted,
      submissionState: submitted ? "TURNED_IN" : draft.missing ? "MISSING" : "NEW",
      late: Boolean(draft.missing) && !submitted,
      grade: null,
      isNew: stillNew,
      discoveredAt,
      importedFrom: source,
      status: submitted ? "turned_in" : draft.missing ? "missing" : "assigned",
    };
    if (source === "scraper" && existing?.importedFrom !== "import") item.importedFrom = "scraper";
    assignments.set(id, item);
    if (source === "scraper" && isNew) newAssignments.push(item);
  }

  const knownIds = Array.from(
    new Set([...previouslyKnown, ...assignments.keys()]),
  ).slice(-4000);

  const ordered = [...assignments.values()].sort((a, b) =>
    String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")),
  );

  await cacheStore.write({
    ...cache,
    courses: [...courses.values()],
    assignments: ordered,
    knownIds,
    fetchedAt: cache.fetchedAt || nowIso,
    syncError: null,
  });

  return {
    firstSync,
    newAssignments: source === "scraper" ? newAssignments : [],
    warnings: [],
    courses: courses.size,
    assignments: ordered.length,
    fetchedAt: cache.fetchedAt || nowIso,
    profile: null,
  };
}

export async function signOut() {
  const { tokens } = await tokenStore.read();
  const revoke = tokens?.refresh_token || tokens?.access_token;
  if (revoke) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: revoke }).toString(),
      });
    } catch {
      // Local sign-out should succeed even if Google is unreachable.
    }
  }
  await tokenStore.clear();
  await cacheStore.clear();
}

async function accessToken(origin) {
  const { tokens } = await tokenStore.read();
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new AppError(
      "needs_google",
      "Connect your Google account to sync Classroom.",
      401,
    );
  }
  const client = createOAuthClient(origin);
  client.setCredentials(tokens);
  try {
    const result = await client.getAccessToken();
    if (!result?.token) throw new Error("No access token returned");
    const merged = { ...tokens, ...client.credentials };
    if (JSON.stringify(merged) !== JSON.stringify(tokens)) {
      await tokenStore.update((current) => ({ ...current, tokens: merged }));
    }
    return result.token;
  } catch (error) {
    throw new AppError(
      "google_auth_expired",
      "Google sign-in expired. Reconnect Classroom in Settings.",
      401,
      String(error?.message || error),
    );
  }
}

async function googleJson(token, pathname, params = {}, attempt = 0) {
  const url = new URL(`${API}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 429 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return googleJson(token, pathname, params, 1);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    if (response.status === 401) {
      throw new AppError(
        "google_auth_expired",
        "Google rejected the saved sign-in. Reconnect Classroom in Settings.",
        401,
        detail,
      );
    }
    if (response.status === 403) {
      throw new AppError(
        "google_permission",
        "Google Classroom refused access to this data.",
        403,
        detail,
      );
    }
    throw new AppError("google_api_error", `Classroom API error (${response.status}).`, 502, detail);
  }
  return response.json();
}

async function listAll(token, pathname, params, key) {
  const items = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const data = await googleJson(token, pathname, {
      ...params,
      pageToken: pageToken || undefined,
    });
    if (Array.isArray(data[key])) items.push(...data[key]);
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

function courseColor(id) {
  let hash = 0;
  for (const character of String(id || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "’",
    lsquo: "‘",
    ldquo: "“",
    rdquo: "”",
    ndash: "–",
    mdash: "—",
    hellip: "…",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    const namedValue = named[code.toLowerCase()];
    if (namedValue !== undefined) return namedValue;

    let parsed = NaN;
    if (code.startsWith("#x") || code.startsWith("#X")) {
      parsed = Number.parseInt(code.slice(2), 16);
    } else if (code.startsWith("#")) {
      parsed = Number.parseInt(code.slice(1), 10);
    }
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10ffff) return match;
    try {
      return String.fromCodePoint(parsed);
    } catch {
      return match;
    }
  });
}

/** Classroom descriptions arrive as HTML; the UI needs readable text. */
export function htmlToText(html) {
  if (!html) return "";
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 4000);
}

/** dueDate/dueTime are UTC in the Classroom API; ISO keeps them unambiguous. */
function courseworkDueIso(work) {
  if (!work?.dueDate) return null;
  const { year, month, day } = work.dueDate;
  const hours = work.dueTime?.hours ?? 23;
  const minutes = work.dueTime?.minutes ?? 59;
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function materialsFor(work) {
  if (!Array.isArray(work.materials)) return [];
  return work.materials
    .map((material) => {
      if (material.driveFile) {
        return {
          title: material.driveFile.title || material.driveFile.driveFile?.title || "Drive file",
          url: material.driveFile.alternateLink || "",
        };
      }
      if (material.link) {
        return { title: material.link.title || "Link", url: material.link.url || "" };
      }
      if (material.youtubeVideo) {
        return {
          title: material.youtubeVideo.title || "Video",
          url: material.youtubeVideo.alternateLink || "",
        };
      }
      if (material.form) {
        return {
          title: material.form.title || "Form",
          url: material.form.formUrl || "",
        };
      }
      return null;
    })
    .filter((material) => material?.url)
    .slice(0, 4);
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function submissionFor(token, courseId, work, previous) {
  const signature = `${courseId}:${work.updateTime || ""}`;
  const submissionKey = `${courseId}:${work.id}`;
  const cached = previous?.submissions?.[submissionKey];
  // Only final submission states are safe to reuse. Open work changes without
  // the coursework's updateTime changing, so it is checked every sync.
  const isFinal = cached && ["TURNED_IN", "RETURNED"].includes(cached.state);
  if (
    cached &&
    isFinal &&
    cached.signature === signature &&
    Date.now() - new Date(cached.checkedAt).getTime() < SUBMISSION_TTL_MS
  ) {
    return cached;
  }
  try {
    const data = await googleJson(
      token,
      `/courses/${courseId}/courseWork/${work.id}/studentSubmissions`,
      { userId: "me", pageSize: 1 },
    );
    const submission = data.studentSubmissions?.[0] || null;
    return {
      signature,
      state: submission?.state || "NEW",
      late: Boolean(submission?.late),
      assignedGrade: submission?.assignedGrade ?? null,
      draftGrade: submission?.draftGrade ?? null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    // A single submission read can fail without making the whole sync useless.
    if (error?.code === "google_auth_expired") throw error;
    return {
      signature,
      state: "UNKNOWN",
      late: false,
      assignedGrade: null,
      draftGrade: null,
      checkedAt: new Date().toISOString(),
      error: String(error?.message || error),
    };
  }
}

/**
 * Fetch every active course, its published coursework and the current
 * student's submission state. Cached submission reads keep repeat syncs cheap.
 */
async function syncViaScraper() {
  const { items, warnings } = await scrapeClassroom();
  const result = await applyImport(items, { source: "scraper" });
  return { ...result, warnings };
}

export async function syncClassroom(origin) {
  if (inFlightSync) return inFlightSync;
  inFlightSync = (async () => {
    const { tokens } = await tokenStore.read();
    if (tokens?.access_token || tokens?.refresh_token) {
      return googleSyncBody(origin);
    }
    if (scraperConfigured() || harvestEnabled()) {
      return syncViaScraper();
    }
    throw new AppError(
      "needs_data_source",
      "No data source yet: paste your Classroom To-do text in Settings → Import, or add CLASSROOM_COOKIES for automatic sync.",
      401,
    );
  })();

  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}

async function googleSyncBody(origin) {
  const token = await accessToken(origin);
    const previous = await cacheStore.read();
    const warnings = [];
    const tokenData = await tokenStore.read();

    let courses = [];
    try {
      courses = await listAll(
        token,
        "/courses",
        { studentId: "me", courseStates: "ACTIVE", pageSize: 100 },
        "courses",
      );
    } catch (error) {
      if (error?.code === "google_auth_expired") throw error;
      if (error?.code === "google_permission") {
        throw new AppError(
          "google_permission",
          "Google Classroom access was denied. Check that the Classroom API is enabled and reconnect.",
          403,
          error.detail,
        );
      }
      throw error;
    }

    const normalizedCourses = courses
      .filter((course) => course.id)
      .map((course) => ({
        id: course.id,
        name: course.name || "Untitled course",
        section: course.section || "",
        room: course.room || "",
        descriptionHeading: course.descriptionHeading || "",
        ownerId: course.ownerId || "",
        alternateLink: course.alternateLink || "",
        color: courseColor(course.id),
      }));

    const previousById = new Map(
      (previous.assignments || []).map((assignment) => [assignment.id, assignment]),
    );
    const previouslyKnown = new Set(previous.knownIds || []);
    const firstSync = previouslyKnown.size === 0;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const assignments = [];
    const submissions = {};

    for (const course of normalizedCourses) {
      let coursework = [];
      try {
        coursework = await listAll(
          token,
          `/courses/${course.id}/courseWork`,
          { courseWorkStates: "PUBLISHED", pageSize: 100 },
          "courseWork",
        );
      } catch (error) {
        if (error?.code === "google_auth_expired") throw error;
        warnings.push(`${course.name}: ${error.message}`);
        continue;
      }

      const visible = coursework.filter((work) => work.id && work.state !== "DELETED");
      const statuses = await mapPool(visible, 4, async (work) => {
        const status = await submissionFor(token, course.id, work, previous);
        submissions[`${course.id}:${work.id}`] = status;
        return status;
      });

      visible.forEach((work, index) => {
        const status = statuses[index];
        const submitted = ["TURNED_IN", "RETURNED"].includes(status.state);
        const dueIso = courseworkDueIso(work);
        const existing = previousById.get(work.id);
        const isNew = !firstSync && !previouslyKnown.has(work.id);
        const discoveredAt = isNew
          ? nowIso
          : existing?.discoveredAt || null;
        const stillNew = discoveredAt
          ? now - new Date(discoveredAt).getTime() < NEW_WINDOW_MS
          : false;

        assignments.push({
          id: `${course.id}:${work.id}`,
          courseworkId: work.id,
          courseId: course.id,
          courseName: course.name,
          courseSection: course.section,
          courseColor: course.color,
          title: work.title || "Untitled assignment",
          description: htmlToText(work.description),
          type: work.workType || "ASSIGNMENT",
          state: work.state || "PUBLISHED",
          dueAt: dueIso,
          maxPoints: typeof work.maxPoints === "number" ? work.maxPoints : null,
          alternateLink: work.alternateLink || course.alternateLink || "",
          materials: materialsFor(work),
          topicId: work.topicId || "",
          createdAt: work.creationTime || null,
          updatedAt: work.updateTime || null,
          submitted,
          submissionState: status.state,
          late: Boolean(status.late),
          grade: status.assignedGrade ?? status.draftGrade ?? null,
          isNew: stillNew,
          discoveredAt,
          status: submitted
            ? status.late
              ? "turned_in_late"
              : "turned_in"
            : status.state === "CREATED"
              ? "draft"
              : "assigned",
        });
      });
    }

    // The sync itself is only "new" for items that appeared after the first
    // successful snapshot; otherwise the first connect would alert everything.
    const newAssignments = firstSync
      ? []
      : assignments.filter((assignment) => !previouslyKnown.has(
          assignment.courseworkId,
        ) && !previousById.has(assignment.id));

    const knownIds = Array.from(
      new Set([
        ...(previous.knownIds || []),
        ...assignments.map((assignment) => assignment.courseworkId),
      ]),
    ).slice(-4000);

    const nextCache = {
      ...previous,
      courses: normalizedCourses,
      assignments,
      submissions,
      knownIds,
      fetchedAt: nowIso,
      syncError: warnings.length
        ? `Some courses could not be read: ${warnings.join(" · ")}`
        : null,
    };
    await cacheStore.write(nextCache);

    return {
      firstSync,
      newAssignments,
      warnings,
      courses: normalizedCourses.length,
      assignments: assignments.length,
      fetchedAt: nowIso,
      profile: tokenData.profile,
    };
}

function enrichCourses(courses, ranked) {
  return courses.map((course) => {
    const items = ranked.filter((assignment) => assignment.courseId === course.id);
    return {
      ...course,
      assignmentCount: items.length,
      openCount: items.filter((assignment) => !assignment.submitted).length,
      doneCount: items.filter((assignment) => assignment.submitted).length,
      pointsOpen: items
        .filter((assignment) => !assignment.submitted)
        .reduce((sum, assignment) => sum + (Number(assignment.maxPoints) || 0), 0),
    };
  });
}

/** Read the cached snapshot (never hits Google) and shape it for the UI. */
export async function cachedDashboard(now = Date.now()) {
  const cache = await cacheStore.read();
  const ranked = rankAssignments(cache.assignments || [], now);
  const stats = computeStats(ranked, now);
  return {
    courses: enrichCourses(cache.courses || [], ranked),
    assignments: ranked,
    stats,
    fetchedAt: cache.fetchedAt || null,
    syncError: cache.syncError || null,
    briefing: cache.briefing || null,
  };
}

export async function saveBriefing(briefing) {
  await cacheStore.update((cache) => ({ ...cache, briefing }));
}

export async function saveDigestDate(dateKey) {
  await cacheStore.update((cache) => ({ ...cache, lastDigestDate: dateKey }));
}

export async function getSyncMeta() {
  const cache = await cacheStore.read();
  return {
    fetchedAt: cache.fetchedAt || null,
    lastDigestDate: cache.lastDigestDate || null,
    syncError: cache.syncError || null,
  };
}

export function syncInProgress() {
  return Boolean(inFlightSync);
}
