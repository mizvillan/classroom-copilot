import crypto from "node:crypto";

import { config } from "./config.js";
import { AppError } from "./errors.js";
import { localBriefing } from "./priority.js";
import { cachedDashboard, saveBriefing } from "./classroom.js";
import { getDemoDashboard } from "./demo.js";

const AI_TIMEOUT_MS = 30_000;
/**
 * Try every model in the chain before falling back to the local planner —
 * a deprecated model or an overloaded one never breaks briefings.
 */
function modelChain() {
  return Array.isArray(config.ai.models) ? config.ai.models : [];
}

/** Changes whenever the visible workload changes, so cached briefings go stale. */
export function briefingSignature(assignments) {
  const parts = [...assignments]
    .map(
      (assignment) =>
        `${assignment.id}|${assignment.title}|${assignment.maxPoints ?? ""}|${
          assignment.dueAt || ""
        }|${assignment.submitted ? 1 : 0}`,
    )
    .sort();
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
}

function aiPayload(assignments) {
  return assignments
    .filter((assignment) => !assignment.submitted)
    .slice(0, 36)
    .map((assignment) => ({
      title: assignment.title,
      course: assignment.courseName,
      due: assignment.duePhrase,
      dueAt: assignment.dueAt,
      points: assignment.maxPoints,
      type: assignment.type,
      priority: assignment.priority.category,
      why: assignment.priority.reasons,
    }));
}

async function callModel(assignments, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const today = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const prompt = [
    "You are Classroom Copilot, a practical academic planner for one student.",
    `Today is ${today.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} (${timezone}).`,
    "",
    "Student workload:",
    JSON.stringify(aiPayload(assignments), null, 2),
    "",
    "Write a briefing in Markdown with exactly these headings when they have content:",
    "### Do first",
    "### This week",
    "### Backlog",
    "### Start now",
    "",
    "Rules:",
    "- Only mention assignments from the data. Never invent one.",
    '- Each bullet: "**Title** — Course · due phrase · N pts". Add the reason when it is not obvious.',
    "- Do first: at most 4. This week: at most 6. Backlog: at most 5.",
    '- Start now: 2–3 sentences naming the single best task and one concrete first step. No generic motivation.',
    "- Under 280 words. No tables, no code fences, no preamble.",
    "- Be direct and calm. This student may be close to a deadline.",
  ].join("\n");

  try {
    const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ai.keys[0]}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 850,
        messages: [
          {
            role: "system",
            content:
              "You are a concise, ruthlessly practical school planner. You never invent assignments or deadlines.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AppError(
        "ai_error",
        `The AI provider returned ${response.status}.`,
        502,
        detail.slice(0, 500),
      );
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string" || !text.trim()) {
      throw new AppError("ai_empty", "The AI returned an empty briefing.", 502);
    }
    return text.trim();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError("ai_timeout", "The AI briefing took too long.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get a briefing for the current workload. With AI configured it asks the
 * model; otherwise (or if the model fails) it falls back to the local planner
 * and reports that instead of showing an error.
 */
export async function generateBriefing({ demo = false, force = false, now = Date.now() } = {}) {
  const dashboard = demo
    ? getDemoDashboard(now)
    : await cachedDashboard(now);

  const signature = briefingSignature(dashboard.assignments);
  const cached = dashboard.briefing;

  if (!demo && !force && cached?.text && cached.signature === signature) {
    return { ...cached, stale: false, warning: "" };
  }

  const fallback = localBriefing(dashboard.assignments, dashboard.stats);
  let text = fallback;
  let source = "local";
  let warning = "";
  let model = null;

  if (config.ai.keys.length && modelChain().length) {
    for (const candidate of modelChain()) {
      try {
        text = await callModel(dashboard.assignments, candidate);
        source = "ai";
        model = candidate;
        break;
      } catch (error) {
        console.warn(
          "[classroom-copilot] AI model failed, trying the next in the chain:",
          error.message,
        );
      }
    }
    if (source !== "ai") {
      warning = "Every AI model in the chain failed, so this is the local planner.";
    }
  } else {
    warning = "No AI key configured — this briefing comes from the local priority engine.";
  }

  const briefing = {
    text,
    source,
    generatedAt: new Date(now).toISOString(),
    signature,
    model,
  };

  if (!demo) await saveBriefing(briefing);
  return { ...briefing, stale: false, warning };
}

/** The cached briefing with an explicit stale flag for the dashboard. */
export async function currentBriefing(dashboard) {
  if (!dashboard.briefing?.text) return null;
  return {
    ...dashboard.briefing,
    stale:
      dashboard.briefing.signature !== briefingSignature(dashboard.assignments),
  };
}
