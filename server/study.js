/**
 * Study Kit — generates flashcards, a quiz with answers, a slide outline and
 * a Q&A cheat-sheet for one assignment. Local ranking stays explainable; this
 * only adds study material. Falls back to a structured outline built from the
 * assignment's own data when no AI model answers.
 */

import { config } from "./config.js";
import { AppError } from "./errors.js";
import { cacheStore } from "./store.js";
import { cachedDashboard } from "./classroom.js";

const TIMEOUT_MS = 45_000;

function assignmentChain(models) {
  return Array.isArray(models) ? models : [];
}

function findAssignment(dashboard, assignmentId) {
  return dashboard.assignments.find(
    (assignment) => assignment.id === assignmentId,
  );
}

function contextPayload(assignment) {
  return {
    title: assignment.title,
    course: assignment.courseName,
    due: assignment.duePhrase,
    points: assignment.maxPoints,
    type: assignment.type,
    description: (assignment.description || "").slice(0, 1500),
    materials: (assignment.materials || []).map((m) => m.title).filter(Boolean),
  };
}

const PROMPT = [
  "You generate study kits for one school assignment.",
  "Answer ONLY with valid JSON matching exactly this shape (no markdown fences, no commentary):",
  '{"aim": "...", "flashcards": [{"front": "...", "back": "..."}],',
  ' "quiz": [{"question": "...", "options": ["a", "b", "c", "d"], "answerIndex": 0, "explanation": "..."}],',
  ' "slides": [{"heading": "...", "bullets": ["..."]}],',
  ' "qa": [{"q": "...", "a": "..."}], "sources": ["..."], "studyPlan": ["..."]}',
  "",
  "Constraints: exactly 8 flashcards, exactly 6 quiz questions (multiple choice), exactly 5 slides, exactly 6 Q&A pairs, exactly 4 studyPlan steps.",
  "Content must come only from the brief of the work below; build plausible school-level study material",
  "(definitions, steps, concepts the student would need to learn basics). sources: short list of what a student",
  "would use (e.g. the assignment brief, own class notes, textbook).",
].join("\n");

async function callModel(payload, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ai.keys[0]}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "You return only valid JSON study material." },
          {
            role: "user",
            content: `${PROMPT}\n\nAssignment brief:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AppError("ai_error", `AI status ${response.status}`, 502);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError("ai_timeout", "Study kit generation timed out.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseKit(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const kit = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(kit.flashcards) || !Array.isArray(kit.quiz)) return null;
    return kit;
  } catch {
    return null;
  }
}

/** Deterministic fallback so the feature never hard-fails without AI. */
function localKit(assignment) {
  const points = assignment.maxPoints ? `${assignment.maxPoints} pts` : "ungraded";
  const desc = assignment.description || "No description was provided.";
  return {
    aim: `Finish "${assignment.title}" (${points}) for ${assignment.courseName}.`,
    flashcards: [
      { front: "What exactly is due?", back: `${assignment.title} — ${points}${assignment.duePhrase ? `, due ${assignment.duePhrase}` : ""}.` },
      { front: "Key details from the brief", back: desc.slice(0, 400) },
      { front: "First step", back: "Open the assignment in Classroom and read the full brief plus materials." },
      { front: "Materials to use", back: (assignment.materials || []).map((m) => m.title).filter(Boolean).join(", ") || "The brief itself." },
      { front: "Time estimate", back: assignment.maxPoints && assignment.maxPoints >= 50 ? "Long task — plan 1-2 sessions." : "Short task — plan one focused session." },
      { front: "How to avoid losing marks", back: "Check the brief for format rules, hand in before the deadline, and review once before submitting." },
      { front: "What if I'm stuck?", back: "Ask the teacher in Classroom comments, then study the linked materials." },
      { front: "Definition to remember", back: desc.slice(0, 120).trim() || "Read the brief; extract any named chapter, formula or topic and make a card from it." },
    ],
    quiz: [
      { question: `When is "${assignment.title}" due?`, options: [assignment.duePhrase || "No due date", "Tomorrow", "Last week", "After the exam"], answerIndex: 0, explanation: "Directly from the brief." },
      { question: `Which course is it for?`, options: [assignment.courseName, "Not related", "All courses", "Electives"], answerIndex: 0, explanation: "Directly from the brief." },
      { question: "What does the description ask for?", options: [desc.slice(0, 100), "Nothing", "A group project", "An exam revision"], answerIndex: 0, explanation: "From the brief text." },
      { question: "How many points is it worth?", options: [String(assignment.maxPoints ?? "0"), "1000", "1", "50 only"], answerIndex: 0, explanation: "Directly from the brief." },
      { question: "What is a good first step?", options: ["Re-read the brief and materials", "Skip it", "Start random research", "Wait for friends"], answerIndex: 0, explanation: "Plan-first habit." },
      { question: "Which habit protects the most marks?", options: ["Submitting before the deadline", "Answering fast", "Copy-paste", "Guessing format"], answerIndex: 0, explanation: "Deadlines and format rules are the top mark-losers." },
    ],
    slides: [
      { heading: "Overview", bullets: [`${assignment.courseName} — ${assignment.title}`, points, assignment.duePhrase || "no due date listed"] },
      { heading: "What the brief says", bullets: desc.split(/\n+/).slice(0, 4).map((s) => s.slice(0, 120)) },
      { heading: "Plan", bullets: ["Read brief + materials", "Break into sections", "Draft", "Revise & submit"] },
      { heading: "Risks", bullets: ["Late penalty", "Format mistakes", "Missing materials"] },
      { heading: "Next actions", bullets: ["Open in Classroom", "Start today", "Check with teacher if unsure"] },
    ],
    qa: [
      { q: "What do I have to produce?", a: `Daily answer: "${assignment.title}". ${desc.slice(0, 150)}` },
      { q: "When is it due?", a: assignment.duePhrase || "No due date was provided." },
      { q: "What materials should I read?", a: (assignment.materials || []).map((m) => m.title).filter(Boolean).join(", ") || "The assignment brief itself." },
      { q: "How is it graded?", a: assignment.maxPoints ? `Out of ${assignment.maxPoints} points.` : "Grading details were not provided." },
      { q: "What's the fastest sensible plan?", a: "Read the brief fully, list the sub-tasks, do the hardest one first, review before submitting." },
      { q: "Where do I submit?", a: "On the assignment page in Google Classroom (Turned-in button), before the closing time." },
    ],
    sources: [
      assignment.alternateLink ? "Assignment brief (Google Classroom link)" : "Assignment brief",
      "Own lesson notes",
      "Linked materials (handouts, slides, videos)",
    ],
    studyPlan: [
      "Skim the brief and mark every requirement (length, format, topic).",
      "Break the work into 3 sub-tasks and slot them into today / tomorrow.",
      `If it involves new concepts, study them first using the flashcards above.`,
      "Write a first draft early, then revise against the brief before submitting.",
    ],
  };
}

/**
 * `dashboard` can be passed in (e.g. the demo set when nothing is connected)
 * so a visitor without real data can still try Study Kits on the samples.
 */
export async function studyKitFor(assignmentId, { force = false, dashboard } = {}) {
  const data = dashboard || (await cachedDashboard());
  const assignment = findAssignment(data, assignmentId);
  if (!assignment) {
    throw new AppError("not_found", "That assignment isn't in your data.", 404);
  }

  const kits = (await cacheStore.read()).studyKits || {};
  const cached = kits[assignmentId];
  const signature = `${assignment.title}|${assignment.dueAt || ""}|${assignment.description || ""}`;
  if (!force && cached?.signature === signature && cached.kit) {
    return { ...cached.kit, cached: true, assignmentId };
  }

  let kit = null;
  let source = "local";
  let model = null;
  const failures = [];

  for (const candidate of assignmentChain(config.ai.models)) {
    try {
      const raw = await callModel(contextPayload(assignment), candidate);
      kit = parseKit(raw);
      if (kit) {
        source = "ai";
        model = candidate;
        break;
      }
      failures.push(`${candidate}: unparseable JSON`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  if (!kit) kit = localKit(assignment);

  await cacheStore.update((cache) => ({
    ...cache,
    studyKits: {
      ...(cache.studyKits || {}),
      [assignmentId]: {
        kit,
        signature,
        exportedAt: new Date().toISOString(),
        source,
        failures: failures.slice(0, 4),
      },
    },
  }));

  return { ...kit, cached: false, assignmentId, source, model };
}

/** Markdown export (also used by the download button and Discord handoff). */
export function kitMarkdown(assignment, kit) {
  const lines = [`# Study Kit — ${assignment.title}`, "", `**Course:** ${assignment.courseName}`];
  if (assignment.duePhrase) lines.push(`**Due:** ${assignment.duePhrase}`);
  if (assignment.maxPoints) lines.push(`**Points:** ${assignment.maxPoints}`);
  lines.push("", `## Aim`, kit.aim || "—", "", `## Flashcards`);
  for (const card of kit.flashcards || []) {
    lines.push(`- **Q:** ${card.front}`, `  **A:** ${card.back}`);
  }
  lines.push("", `## Quiz`);
  for (const [index, item] of (kit.quiz || []).entries()) {
    lines.push(`**${index + 1}. ${item.question}**`);
    for (const [idx, option] of item.options.entries()) {
      lines.push(`${idx === item.answerIndex ? "- [x]" : "- [ ]"} ${option}`);
    }
    lines.push(`> ${item.explanation}`, "");
  }
  lines.push(`## Slides`);
  for (const slide of kit.slides || []) {
    lines.push(`### ${slide.heading}`);
    for (const bullet of slide.bullets || []) lines.push(`- ${bullet}`);
  }
  lines.push("", `## Q&A`);
  for (const item of kit.qa || []) lines.push(`**Q:** ${item.q}`, `**A:** ${item.a}`, "");
  lines.push(`## Study plan`);
  for (const step of kit.studyPlan || []) lines.push(`- ${step}`);
  return lines.join("\n");
}
