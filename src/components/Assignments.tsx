import { useDeferredValue, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  Inbox,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import type { Assignment, Dashboard, PriorityCategory } from "../types";
import { dueMeta, plural, typeLabel } from "../lib/format";
import { StudyKitModal } from "./StudyKitModal";

type CategoryFilter = "all" | Exclude<PriorityCategory, "done">;
type SortMode = "priority" | "due" | "course";

const CATEGORIES: Array<{ id: CategoryFilter; label: string }> = [
  { id: "all", label: "All open" },
  { id: "now", label: "Do first" },
  { id: "week", label: "This week" },
  { id: "later", label: "Backlog" },
];

type Props = {
  data: Dashboard;
  courseFilter: string;
  onCourseFilter: (courseId: string) => void;
};

export function Assignments({ data, courseFilter, onCourseFilter }: Props) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("priority");
  const [showDone, setShowDone] = useState(false);
  const [kitAssignment, setKitAssignment] = useState<Assignment | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const courseOptions = useMemo(
    () => [...data.courses].sort((a, b) => a.name.localeCompare(b.name)),
    [data.courses],
  );

  const counts = useMemo(() => {
    const open = data.assignments.filter((assignment) => !assignment.submitted);
    return {
      all: open.length,
      now: open.filter((assignment) => assignment.priority.category === "now").length,
      week: open.filter((assignment) => assignment.priority.category === "week").length,
      later: open.filter((assignment) => assignment.priority.category === "later")
        .length,
    };
  }, [data.assignments]);

  const shown = useMemo(() => {
    let list = data.assignments.filter((assignment) => {
      if (courseFilter !== "all" && assignment.courseId !== courseFilter) return false;
      if (assignment.submitted && !showDone) return false;
      if (category !== "all" && assignment.priority.category !== category) return false;
      if (deferredQuery) {
        const haystack = `${assignment.title} ${assignment.courseName} ${assignment.description}`.toLowerCase();
        if (!haystack.includes(deferredQuery)) return false;
      }
      return true;
    });

    if (sort === "due") {
      list = [...list].sort((a, b) => {
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return aDue - bDue;
      });
    } else if (sort === "course") {
      list = [...list].sort(
        (a, b) =>
          a.courseName.localeCompare(b.courseName) ||
          a.title.localeCompare(b.title),
      );
    }
    return list;
  }, [data.assignments, courseFilter, showDone, category, deferredQuery, sort]);

  const courseName =
    courseFilter === "all"
      ? ""
      : data.courses.find((course) => course.id === courseFilter)?.name || "";

  return (
    <div className="view">
      <section className="page-head">
        <div>
          <p className="eyebrow">Everything in one place</p>
          <h1>Assignments</h1>
          <p className="page-sub">
            {data.stats.active} open {plural(data.stats.active, "task")}
            {data.stats.overdue > 0
              ? ` · ${data.stats.overdue} ${plural(data.stats.overdue, "item")} overdue`
              : ""}
            . Ranked by urgency, stakes and points.
          </p>
        </div>
        {data.stats.newCount > 0 ? (
          <span className="badge badge-new badge-lg">
            {data.stats.newCount} new
          </span>
        ) : null}
      </section>

      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assignments or courses…"
            aria-label="Search assignments"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>

        <label className="select-box">
          <span className="sr-only">Filter by course</span>
          <select
            value={courseFilter}
            onChange={(event) => onCourseFilter(event.target.value)}
          >
            <option value="all">All courses</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>

        <label className="select-box">
          <span className="sr-only">Sort assignments</span>
          <SlidersHorizontal size={14} className="select-leading" />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="priority">Priority</option>
            <option value="due">Due date</option>
            <option value="course">Course</option>
          </select>
          <ChevronDown size={14} />
        </label>
      </div>

      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="Priority filter">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "is-active" : ""}
              onClick={() => setCategory(item.id)}
              aria-pressed={category === item.id}
            >
              {item.label}
              <span>{counts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="filter-meta">
          {courseName ? (
            <button
              type="button"
              className="active-filter"
              onClick={() => onCourseFilter("all")}
            >
              {courseName}
              <X size={12} />
            </button>
          ) : null}
          <label className="check-filter">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(event) => setShowDone(event.target.checked)}
            />
            <span>Show turned in</span>
          </label>
          <span className="result-count">{shown.length} shown</span>
        </div>
      </div>

      {shown.length ? (
        <div className="task-list">
          {shown.map((assignment) => (
            <TaskRow
              key={assignment.id}
              assignment={assignment}
              onOpenKit={() => setKitAssignment(assignment)}
            />
          ))}
        </div>
      ) : (
        <div className="panel empty-panel empty-large">
          <span className="empty-icon">
            <Inbox size={24} />
          </span>
          <h3>No assignments match this view.</h3>
          <p>Try a different course, search term, or include turned-in work.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setCategory("all");
              setQuery("");
              setShowDone(false);
              onCourseFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
      )}

      <StudyKitModal
        assignment={kitAssignment}
        aiConfigured={data.setup.aiConfigured}
        onClose={() => setKitAssignment(null)}
      />
    </div>
  );
}

function TaskRow({
  assignment,
  onOpenKit,
}: {
  assignment: Assignment;
  onOpenKit: () => void;
}) {
  const due = dueMeta(assignment.dueAt);
  const overdue =
    !assignment.submitted && due.tone === "danger" && due.label.startsWith("Overdue");

  return (
    <article
      className={`task-row priority-${assignment.priority.category}${
        assignment.submitted ? " is-done" : ""
      }`}
      style={{ "--course": assignment.courseColor } as CSSProperties}
    >
      <span className="task-status" aria-hidden="true">
        {assignment.submitted ? (
          <CheckCircle2 size={19} />
        ) : (
          <Circle size={19} className={overdue ? "is-overdue" : ""} />
        )}
      </span>

      <div className="task-main">
        <div className="task-title-row">
          {assignment.alternateLink ? (
            <a
              className="task-title"
              href={assignment.alternateLink}
              target="_blank"
              rel="noreferrer"
            >
              {assignment.title}
            </a>
          ) : (
            <span className="task-title">{assignment.title}</span>
          )}
          {assignment.isNew ? <span className="badge badge-new">New</span> : null}
          {overdue ? <span className="badge badge-danger">Missing</span> : null}
          {assignment.submitted && assignment.late ? (
            <span className="badge badge-warn">Late</span>
          ) : null}
        </div>
        {assignment.description ? (
          <p className="task-desc">{assignment.description}</p>
        ) : null}
        <div className="task-meta">
          <span className="course-chip">
            <i style={{ background: assignment.courseColor }} />
            {assignment.courseName}
          </span>
          <span className={`priority-pill pill-${assignment.priority.category}`}>
            {assignment.priority.label}
          </span>
          <span>{typeLabel(assignment.type)}</span>
          <span>{assignment.maxPoints ? `${assignment.maxPoints} pts` : "No points"}</span>
        </div>
      </div>

      <div className="task-side">
        <span className={`task-due tone-${due.tone}`}>{due.label}</span>
        {assignment.dueAt ? <span className="task-date">{due.exact}</span> : null}
        <button
          type="button"
          className="task-kit"
          onClick={onOpenKit}
          title="Open the Study Kit: flashcards, quiz, slides and answers"
        >
          <BookOpenCheck size={14} />
          Study kit
        </button>
        {assignment.alternateLink ? (
          <a
            className="task-open"
            href={assignment.alternateLink}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${assignment.title} in Google Classroom`}
          >
            <ArrowUpRight size={16} />
          </a>
        ) : null}
      </div>
    </article>
  );
}
