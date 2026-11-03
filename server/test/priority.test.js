import assert from "node:assert/strict";
import test from "node:test";

import {
  computePriority,
  computeStats,
  duePhrase,
  localBriefing,
  rankAssignments,
} from "../priority.js";
import { chunkForDiscord } from "../format.js";

const NOW = new Date("2026-11-02T12:00:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;

function assignment(overrides = {}) {
  return {
    id: "a1",
    courseName: "Calculus II",
    title: "Problem set 9",
    dueAt: new Date(NOW + 6 * HOUR).toISOString(),
    maxPoints: 40,
    submitted: false,
    late: false,
    ...overrides,
  };
}

test("an assignment due in hours outranks one due in days", () => {
  const soon = computePriority(assignment(), NOW);
  const later = computePriority(
    assignment({ dueAt: new Date(NOW + 6 * 24 * HOUR).toISOString() }),
    NOW,
  );
  assert.ok(soon.score > later.score);
  assert.equal(soon.category, "now");
  assert.equal(later.category, "week");
});

test("a project more than a week away is not labelled this week", () => {
  const farProject = computePriority(
    assignment({
      title: "Final project",
      maxPoints: 100,
      dueAt: new Date(NOW + 9 * 24 * HOUR).toISOString(),
    }),
    NOW,
  );
  assert.equal(farProject.category, "later");
});

test("overdue work gets the strongest urgency and a clear reason", () => {
  const overdue = computePriority(
    assignment({ dueAt: new Date(NOW - 2 * 24 * HOUR).toISOString() }),
    NOW,
  );
  assert.ok(overdue.score >= 140);
  assert.equal(overdue.category, "now");
  assert.match(overdue.reasons[0], /Overdue by 2 days/);
});

test("high-stakes and high-point work gets a boost", () => {
  const quiz = computePriority(
    assignment({ title: "Unit exam", maxPoints: 100 }),
    NOW,
  );
  const reading = computePriority(
    assignment({ title: "Reading: chapter 12", maxPoints: 10 }),
    NOW,
  );
  assert.ok(quiz.score > reading.score);
  assert.match(quiz.reasons.join(" "), /High-stakes work/);
});

test("submitted work is demoted and marked done", () => {
  const done = computePriority(assignment({ submitted: true }), NOW);
  assert.equal(done.category, "done");
  assert.equal(done.score, 4);
});

test("ranking puts open urgent work before turned-in work", () => {
  const ranked = rankAssignments(
    [
      assignment({
        id: "done",
        title: "Old worksheet",
        submitted: true,
        dueAt: new Date(NOW - 8 * 24 * HOUR).toISOString(),
      }),
      assignment({
        id: "later",
        title: "Final project",
        dueAt: new Date(NOW + 10 * 24 * HOUR).toISOString(),
        maxPoints: 100,
      }),
      assignment({ id: "soon", title: "Quiz", dueAt: new Date(NOW + HOUR).toISOString() }),
    ],
    NOW,
  );
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["soon", "later", "done"],
  );
});

test("stats count overdue, the week window and done work separately", () => {
  const stats = computeStats(
    [
      assignment({ id: "s1", submitted: true }),
      assignment({ id: "s2", dueAt: new Date(NOW - HOUR).toISOString() }),
      assignment({ id: "s3", dueAt: new Date(NOW + 2 * 24 * HOUR).toISOString() }),
      assignment({ id: "s4", dueAt: null }),
    ],
    NOW,
  );
  assert.equal(stats.total, 4);
  assert.equal(stats.active, 3);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.dueWeek, 1);
  assert.equal(stats.done, 1);
  assert.equal(stats.completion, 25);
});

test("due phrasing handles missing and future dates", () => {
  assert.equal(duePhrase(null, NOW), "No due date");
  assert.match(duePhrase(new Date(NOW + 2 * HOUR).toISOString(), NOW), /Due in 2h/);
});

test("the local briefing names the top task and includes its course", () => {
  const ranked = rankAssignments(
    [
      assignment({
        id: "urgent",
        title: "Problem set 9",
        dueAt: new Date(NOW + HOUR).toISOString(),
      }),
      assignment({
        id: "later",
        title: "Final essay",
        dueAt: new Date(NOW + 6 * 24 * HOUR).toISOString(),
        maxPoints: 100,
      }),
    ],
    NOW,
  );
  const briefing = localBriefing(ranked, computeStats(ranked, NOW));
  assert.match(briefing, /### Do first/);
  assert.match(briefing, /Problem set 9/);
  assert.match(briefing, /### Start now/);
});

test("Discord chunking never exceeds the limit and keeps all content", () => {
  const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} `.repeat(12));
  const chunks = chunkForDiscord(paragraphs.join("\n\n"), 300);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 300);
  const joined = chunks.join("\n\n").replace(/\s+/g, " ");
  assert.match(joined, /Paragraph 0/);
  assert.match(joined, /Paragraph 29/);
});
