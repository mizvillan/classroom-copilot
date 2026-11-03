import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const env = process.env;
const clean = (value) => String(value ?? "").trim();
const withoutTrailingSlash = (value) => value.replace(/\/+$/, "");

/** "07:30" -> { hours: 7, minutes: 30 }; anything else -> null (disabled). */
function parseDigestTime(value, fallback) {
  const raw = clean(value) || fallback;
  if (raw.toLowerCase() === "off") return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hours: 7, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { hours: 7, minutes: 0 };
  return { hours, minutes };
}

/** The same Groq chain the Mizvillan bot leads with (bot/Mizvillan's bot/ai.js). */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const AI_MODELS = [
  "qwen/qwen3.8-27b", // fast, chatty, no reasoning overhead
  "groq/compound-mini", // backup (Groq's agent system)
  "openai/gpt-oss-120b", // smart backup (reasoning model — slower)
];

function readCookieFile(filePath) {
  try {
    return clean(fs.readFileSync(String(filePath), "utf8"));
  } catch {
    return "";
  }
}

function envList(...names) {
  return names.flatMap((name) =>
    clean(env[name])
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

const explicitKeys = envList("OPENAI_API_KEYS", "OPENAI_API_KEY", "AI_API_KEYS", "AI_API_KEY", "GROQ_API_KEYS", "GROQ_API_KEY");
const explicitBaseUrl = withoutTrailingSlash(clean(env.AI_BASE_URL));
const hasGroqKey = explicitKeys.some((key) => key.startsWith("gsk_")) || !explicitBaseUrl;

export const config = {
  root: ROOT,
  distDir: path.join(ROOT, "dist"),
  dataDir: path.join(ROOT, "data"),
  // Some hosts export PORT=0 while warming up; that would bind a random port
  // and break the redirect URI, so only accept a real, positive port.
  port: (() => {
    const parsed = Number(env.PORT);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 8790;
  })(),
  host: clean(env.HOST) || "0.0.0.0",
  appOrigin: withoutTrailingSlash(clean(env.APP_ORIGIN)),
  syncIntervalMinutes: Math.max(5, Number(env.SYNC_INTERVAL_MINUTES || 15)),
  classroom: {
    // The browser's Cookie header for an open classroom.google.com session.
    // Copied straight from DevTools, or set CLASSROOM_COOKIE_FILE to a path.
    cookies: clean(env.CLASSROOM_COOKIES) || readCookieFile(env.CLASSROOM_COOKIE_FILE),
  },
  ai: {
    keys: explicitKeys.filter(Boolean),
    baseUrl: explicitBaseUrl || (hasGroqKey ? GROQ_BASE_URL : "https://freebuff.com/api/v1/paid"),
    models: envList("AI_MODELS", "AI_MODEL").length
      ? envList("AI_MODELS", "AI_MODEL")
      : AI_MODELS,
  },
  discord: {
    token: clean(env.DISCORD_BOT_TOKEN),
    channelId: clean(env.DISCORD_CHANNEL_ID),
    guildId: clean(env.DISCORD_GUILD_ID),
    digestTime: parseDigestTime(env.DISCORD_DIGEST_TIME, "07:00"),
    alerts: clean(env.DISCORD_ALERTS || "true").toLowerCase() !== "false",
  },
};

export function publicConfig() {
  return {
    cookieSync: Boolean(config.classroom.cookies),
    aiConfigured: Boolean(config.ai.keys.length),
    aiModel: config.ai.models[0],
    discordConfigured: Boolean(config.discord.token),
    discordChannelConfigured: Boolean(config.discord.channelId),
    digestTime: config.discord.digestTime
      ? `${String(config.discord.digestTime.hours).padStart(2, "0")}:${String(
          config.discord.digestTime.minutes,
        ).padStart(2, "0")}`
      : "off",
    alerts: config.discord.alerts,
    syncIntervalMinutes: config.syncIntervalMinutes,
    demoMode: clean(env.DEMO_MODE || "false").toLowerCase() === "true",
  };
}
