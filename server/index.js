import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";

import express from "express";

import { config, publicConfig } from "./config.js";
import { AppError, toErrorResponse } from "./errors.js";
import {
  applyImport,
  cachedDashboard,
  connection,
  createAuthUrl,
  exchangeCode,
  getSyncMeta,
  oauthConfigured,
  redirectUriFor,
  saveDigestDate,
  signOut,
  syncClassroom,
  syncInProgress,
} from "./classroom.js";
import { currentBriefing, generateBriefing } from "./briefing.js";
import { parsePaste } from "./parser.js";
import { kitMarkdown, studyKitFor } from "./study.js";
import { getDemoDashboard } from "./demo.js";
import {
  discordStatus,
  sendDailyDigest,
  sendDiscordTest,
  sendNewAssignmentAlerts,
  startDiscordBot,
  stopDiscordBot,
} from "./discord.js";
import { localDateKey } from "./format.js";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const authStates = new Map();

function requestOrigin(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwarded || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function appOrigin(req) {
  return (config.appOrigin || requestOrigin(req)).replace(/\/+$/, "");
}

function mobileUrls() {
  if (!["0.0.0.0", "::", ""].includes(config.host)) return [];
  const urls = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${config.port}`);
      }
    }
  }
  return urls.slice(0, 4);
}

async function buildStatus(req) {
  const [{ connected, profile }, meta] = await Promise.all([
    connection(),
    getSyncMeta(),
  ]);
  return {
    connected,
    profile,
    google: {
      configured: oauthConfigured(),
      redirectUri: redirectUriFor(appOrigin(req)),
    },
    discord: discordStatus(),
    setup: publicConfig(appOrigin(req)),
    cache: {
      fetchedAt: meta.fetchedAt,
      syncError: meta.syncError,
      syncing: syncInProgress(),
    },
    mobileUrls: mobileUrls(),
    serverTime: new Date().toISOString(),
  };
}

async function syncAndNotify(origin) {
  const result = await syncClassroom(origin);
  if (
    result.newAssignments.length > 0 &&
    !result.firstSync &&
    config.discord.alerts &&
    discordStatus().ready
  ) {
    const sent = await sendNewAssignmentAlerts(result.newAssignments);
    if (!sent.ok) {
      console.warn(
        "[classroom-copilot] New-assignment alert could not be sent:",
        sent.error,
      );
    }
  }
  return result;
}

async function dashboardPayload(req, { demo = false, origin } = {}) {
  const { connected, profile } = await connection();
  const useDemo = demo || !connected;
  const source = useDemo ? "demo" : "google";

  if (!useDemo) {
    const meta = await getSyncMeta();
    if (!meta.fetchedAt) {
      try {
        await syncAndNotify(origin || appOrigin(req));
      } catch (error) {
        // The dashboard still renders with the error surfaced.
        console.warn("[classroom-copilot] First sync failed:", error.message);
      }
    }
  }

  const data = useDemo
    ? getDemoDashboard()
    : await cachedDashboard();
  const briefing = await currentBriefing({
    ...data,
    briefing: data.briefing,
  });
  const { connected: stillConnected, profile: latestProfile } =
    useDemo ? { connected, profile } : await connection();

  return {
    source,
    connected: stillConnected,
    profile: latestProfile,
    courses: data.courses,
    assignments: data.assignments,
    stats: data.stats,
    briefing,
    fetchedAt: data.fetchedAt,
    syncError: data.syncError || null,
    syncing: syncInProgress(),
    setup: publicConfig(appOrigin(req)),
    discord: discordStatus(),
    mobileUrls: mobileUrls(),
    serverTime: new Date().toISOString(),
  };
}

// ── Auth ────────────────────────────────────────────────────────────────────

app.get("/api/auth/google", async (req, res) => {
  if (!oauthConfigured()) {
    res.redirect("/?google=not-configured");
    return;
  }
  for (const [key, entry] of authStates) {
    if (entry.expires < Date.now()) authStates.delete(key);
  }
  const state = crypto.randomBytes(24).toString("hex");
  authStates.set(state, { expires: Date.now() + 10 * 60_000 });
  try {
    const url = createAuthUrl(appOrigin(req), state);
    res.redirect(url);
  } catch (error) {
    console.error("[classroom-copilot] Could not start Google auth:", error);
    res.redirect("/?google=error");
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const entry = typeof state === "string" ? authStates.get(state) : null;
  if (state) authStates.delete(state);

  if (error || !code || !entry || entry.expires < Date.now()) {
    res.redirect(error === "access_denied" ? "/?google=denied" : "/?google=error");
    return;
  }

  try {
    await exchangeCode(String(code), appOrigin(req));
    try {
      await syncClassroom(appOrigin(req));
    } catch (syncError) {
      console.warn(
        "[classroom-copilot] Connected, but the first sync failed:",
        syncError.message,
      );
    }
    res.redirect("/?google=connected");
  } catch (authError) {
    console.error("[classroom-copilot] Google OAuth failed:", authError);
    res.redirect("/?google=error");
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    await signOut();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ── Data ────────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: "1.0.0", serverTime: new Date().toISOString() });
});

app.get("/api/status", async (req, res, next) => {
  try {
    res.json(await buildStatus(req));
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", async (req, res, next) => {
  try {
    const demo = req.query.demo === "1" || req.query.demo === "true";
    res.setHeader("Cache-Control", "no-store");
    res.json(await dashboardPayload(req, { demo }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync", async (req, res, next) => {
  try {
    const { connected } = await connection();
    if (!connected && !config.classroom.cookies) {
      throw new AppError(
        "needs_data_source",
        "No data source yet — paste your Classroom To-do text in Settings → Import, or add CLASSROOM_COOKIES for automatic sync.",
        401,
      );
    }
    if (!connected && config.classroom.cookies) {
      // Nothing imported yet but the scraper is configured — run it directly.
      const result = await syncAndNotify(appOrigin(req));
      res.json({ syncedVia: "scraper", ...result, newCount: result.newAssignments.length });
      return;
    }
    const result = await syncAndNotify(appOrigin(req));
    res.json({ syncedVia: "google", ...result, newCount: result.newAssignments.length });
  } catch (error) {
    next(error);
  }
});

// ── Manual import (no Google API needed) ────────────────────────────────

app.post("/api/import/parse", async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) {
      throw new AppError("nothing_to_parse", "Paste some text first.", 400);
    }
    const { drafts, dropped } = parsePaste(text, Date.now());
    res.json({ drafts, dropped, count: drafts.length });
  } catch (error) {
    next(error);
  }
});

app.post("/api/import/apply", async (req, res, next) => {
  try {
    const drafts = Array.isArray(req.body?.drafts) ? req.body.drafts : null;
    if (!drafts) {
      throw new AppError("bad_request", "Provide the drafts array from /api/import/parse.", 400);
    }
    const clean = drafts
      .filter((draft) => draft && typeof draft === "object" && String(draft.title || "").trim())
      .slice(0, 500)
      .map((draft) => ({
        title: String(draft.title).trim(),
        courseName: String(draft.courseName || "").trim(),
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        maxPoints: Number.isFinite(Number(draft.maxPoints)) ? Number(draft.maxPoints) : null,
        submitted: Boolean(draft.submitted),
        missing: Boolean(draft.missing),
      }));
    if (!clean.length) {
      throw new AppError("invalid_drafts", "Every row needs at least a title.", 400);
    }
    await applyImport(clean, { source: "import" });
    res.json({ ok: true, imported: clean.length });
  } catch (error) {
    next(error);
  }
});

// ── Study Kit ─────────────────────────────────────────────────────────

app.post("/api/study", async (req, res, next) => {
  try {
    const assignmentId = String(req.body?.assignmentId || "");
    if (!assignmentId) {
      throw new AppError("bad_request", "Which assignment? Send assignmentId.", 400);
    }
    const force = Boolean(req.body?.force);
    res.setHeader("Cache-Control", "no-store");
    // Same demo/real split the dashboard uses, so the samples are explorable.
    const { connected } = await connection();
    const dashboard = connected ? undefined : getDemoDashboard();
    res.json(await studyKitFor(assignmentId, { force, dashboard }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/study/download", async (req, res, next) => {
  try {
    const assignmentId = String(req.query.id || "");
    const { connected } = await connection();
    const dashboard = connected ? await cachedDashboard() : getDemoDashboard();
    const assignment = dashboard.assignments.find((item) => item.id === assignmentId);
    if (!assignment) {
      throw new AppError("not_found", "That assignment isn't in your data.", 404);
    }
    const kit = await studyKitFor(assignmentId, { dashboard });
    const markdown = kitMarkdown(assignment, kit);
    const safeName = assignment.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "study-kit";
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="study-kit-${safeName}.md"`,
    );
    res.send(markdown);
  } catch (error) {
    next(error);
  }
});

app.post("/api/briefing", async (req, res, next) => {
  try {
    const { connected } = await connection();
    const demo = Boolean(req.body?.demo) || !connected;
    const force = Boolean(req.body?.force);

    if (!demo) {
      const meta = await getSyncMeta();
      if (!meta.fetchedAt) await syncClassroom(appOrigin(req));
    }

    const briefing = await generateBriefing({ demo, force });
    res.setHeader("Cache-Control", "no-store");
    res.json(briefing);
  } catch (error) {
    next(error);
  }
});

app.post("/api/discord/test", async (req, res, next) => {
  try {
    const result = await sendDiscordTest();
    if (!result.ok) {
      throw new AppError("discord_unavailable", result.error || "Discord is not ready.", 400);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── Static app ──────────────────────────────────────────────────────────────

if (existsSync(config.distDir)) {
  app.use(
    express.static(config.distDir, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
}

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    next();
    return;
  }
  const indexFile = path.join(config.distDir, "index.html");
  if (existsSync(indexFile)) {
    res.sendFile(indexFile);
    return;
  }
  res
    .status(503)
    .type("text/plain")
    .send("Frontend not built yet. Run `npm run build`, or use `npm run dev` on port 5274.");
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: "Unknown API route." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, body } = toErrorResponse(error);
  res.status(status).json(body);
});

// ── Schedules ───────────────────────────────────────────────────────────────

let lastSyncTick = 0;

async function schedulerTick() {
  const now = new Date();
  const { connected } = await connection();

  if (connected) {
    const meta = await getSyncMeta();
    const dueForSync =
      !meta.fetchedAt ||
      Date.now() - new Date(meta.fetchedAt).getTime() >=
        config.syncIntervalMinutes * 60_000;
    if (dueForSync && Date.now() - lastSyncTick > 5 * 60_000) {
      lastSyncTick = Date.now();
      try {
        await syncAndNotify(config.appOrigin || `http://localhost:${config.port}`);
      } catch (error) {
        console.warn("[classroom-copilot] Scheduled sync failed:", error.message);
      }
    }
  }

  const digest = config.discord.digestTime;
  if (digest && discordStatus().ready) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = digest.hours * 60 + digest.minutes;
    const minutesLate = nowMinutes - targetMinutes;
    // A three-hour catch-up window means a laptop that wakes at 8:10 still
    // gets its 7:00 digest, but a server started at midnight does not spam it.
    if (minutesLate >= 0 && minutesLate <= 180) {
      const key = localDateKey(now);
      const meta = await getSyncMeta();
      if (meta.lastDigestDate === key) return;
      // Never send the sample data to Discord as if it were real work.
      if (!connected || !meta.fetchedAt) return;

      try {
        const data = await cachedDashboard();
        if (data.assignments.length === 0 && !data.fetchedAt) return;
        const sent = await sendDailyDigest(data);
        if (sent.ok) {
          await saveDigestDate(key);
          console.log("[classroom-copilot] Discord daily digest sent.");
        } else {
          console.warn("[classroom-copilot] Digest failed:", sent.error);
        }
      } catch (error) {
        console.warn("[classroom-copilot] Digest failed:", error.message);
      }
    }
  }
}

const server = app.listen(config.port, config.host, async () => {
  console.log("");
  console.log("  Classroom Copilot");
  console.log(`  Web     http://localhost:${config.port}`);
  for (const url of mobileUrls()) console.log(`  Phone   ${url}`);
  console.log(
    `  Data    ${config.classroom.cookies ? "cookie auto-sync on" : "paste import / manual sync"}`,
  );
  console.log(
    `  AI      ${config.ai.keys.length ? config.ai.models.join(" → ") : "local planner (no key)"}`,
  );
  console.log(
    `  Discord ${config.discord.token ? "starting bot…" : "off (no token)"}`,
  );
  console.log("");

  await startDiscordBot({
    getDashboard: async () => {
      const { connected } = await connection();
      if (!connected) {
        throw new AppError(
          "needs_google",
          "Google Classroom isn't connected yet.",
          400,
        );
      }
      return cachedDashboard();
    },
    sync: () =>
      syncAndNotify(config.appOrigin || `http://localhost:${config.port}`),
    briefing: async ({ force = false } = {}) => {
      const { connected } = await connection();
      if (!connected) {
        throw new AppError(
          "needs_google",
          "Google Classroom isn't connected yet.",
          400,
        );
      }
      const meta = await getSyncMeta();
      if (!meta.fetchedAt) {
        await syncClassroom(config.appOrigin || `http://localhost:${config.port}`);
      }
      return generateBriefing({ demo: false, force });
    },
  }).catch((error) => {
    console.warn("[classroom-copilot] Discord bot failed to start:", error.message);
  });

  setInterval(() => {
    schedulerTick().catch((error) =>
      console.warn("[classroom-copilot] Scheduler error:", error.message),
    );
  }, 60_000).unref();

  // A connected account with an old cache should refresh shortly after boot.
  setTimeout(() => {
    schedulerTick().catch(() => {});
  }, 3_000).unref();
});

async function shutdown(signal) {
  console.log(`\n[classroom-copilot] ${signal} received, shutting down.`);
  await stopDiscordBot();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
