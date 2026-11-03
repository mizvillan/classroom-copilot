import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Info,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Assignment, Dashboard, Tab } from "../types";
import {
  courseAbbr,
  dueMeta,
  greeting,
  longDate,
  plural,
  relativeTime,
  typeLabel,
} from "../lib/format";

const DAY = 86_400_000;

type Props = {
  data: Dashboard;
  syncing: boolean;
  generating: boolean;
  onSync: () => void;
  onConnect: () => void;
  onTab: (tab: Tab) => void;
  onGenerateBriefing: () => void;
};

export function Overview({
  data,
  syncing,
  generating,
  onSync,
  onConnect,
  onTab,
  onGenerateBriefing,
}: Props) {
  const now = Date.now();
  const active = useMemo(
    () => data.assignments.filter((assignment) => !assignment.submitted),
    [data.assignments],
  );
  const focus = active.slice(0, 3);
  const focusIds = new Set(focus.map((assignment) => assignment.id));
  const nextSeven = active
    .filter((assignment) => {
      if (!assignment.dueAt || focusIds.has(assignment.id)) return false;
      return new Date(assignment.dueAt).getTime() <= now + 7 * DAY;
    })
    .sort(
      (a, b) =>
        new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime(),
    )
    .slice(0, 10);

  const overdueLine =
    data.stats.overdue > 0
      ? `${data.stats.overdue} ${plural(data.stats.overdue, "task")} ${
          data.stats.overdue === 1 ? "is" : "are"
        } overdue.`
      : "";
  const summary =
    overdueLine ||
    (data.stats.due48h > 0
      ? `${data.stats.due48h} ${plural(data.stats.due48h, "task")} due in the next 48 hours.`
      : "Nothing due soon. A rare and beautiful thing.");

  return (
    <div className="view overview-view">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{longDate()}</p>
          <h1>
            {greeting()}
            <span className="accent">.</span>
          </h1>
          <p className="hero-sub">{summary}</p>
        </div>
        <div className="hero-actions">
          {!data.connected ? (
            <button type="button" className="btn btn-primary" onClick={onConnect}>
              <GraduationCap size={16} />
              Connect Classroom
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onSync}
              disabled={syncing}
            >
              <RefreshCw size={16} className={syncing ? "spin" : ""} />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onTab("assignments")}
          >
            All work
            <ArrowRight size={15} />
          </button>
        </div>
      </section>

      {!data.connected ? (
        <div className="notice notice-demo">
          <span className="notice-icon">
            <Info size={16} />
          </span>
          <p>
            <strong>You&apos;re looking at sample data.</strong> Connect Google
            Classroom and this page fills with your real deadlines, submission
            status and courses.
          </p>
          <button type="button" className="btn btn-dark btn-sm" onClick={onConnect}>
            Connect
          </button>
        </div>
      ) : null}

      {data.syncError ? (
        <div className="notice notice-error">
          <span className="notice-icon">
            <AlertTriangle size={16} />
          </span>
          <p>{data.syncError}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSync}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="stats-panel" aria-label="Workload summary">
        <Stat
          label="Overdue"
          value={data.stats.overdue}
          hint={
            data.stats.overdue > 0 ? "Put these back on track" : "Nothing slipping"
          }
          icon={<AlertTriangle size={16} />}
          tone={data.stats.overdue > 0 ? "danger" : undefined}
        />
        <Stat
          label="Next 48 hours"
          value={data.stats.due48h}
          hint={`${data.stats.dueToday} due today`}
          icon={<Clock3 size={16} />}
        />
        <Stat
          label="This week"
          value={data.stats.dueWeek}
          hint={`${data.stats.pointsThisWeek} points at stake`}
          icon={<CalendarDays size={16} />}
        />
        <Stat
          label="Turned in"
          value={data.stats.done}
          hint={`${data.stats.completion}% of all work`}
          icon={<CheckCircle2 size={16} />}
          tone="good"
        />
      </section>

      <div className="overview-grid">
        <div className="overview-main">
          <section className="focus-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Priority stack</p>
                <h2>Do these first</h2>
              </div>
              <span className="section-aside">
                {active.length} open {plural(active.length, "task")}
              </span>
            </div>

            {focus.length ? (
              <div className="focus-list">
                {focus.map((assignment, index) => (
                  <FocusCard
                    key={assignment.id}
                    assignment={assignment}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="panel empty-panel">
                <span className="empty-icon">
                  <CheckCircle2 size={24} />
                </span>
                <h3>Nothing urgent in the stack.</h3>
                <p>
                  You&apos;re clear for now. Take the win, or get ahead on a
                  longer project in the backlog.
                </p>
              </div>
            )}
          </section>

          <Timeline
            items={nextSeven}
            now={now}
            onTab={() => onTab("assignments")}
          />
        </div>

        <aside className="overview-side">
          <BriefingCard
            briefing={data.briefing}
            generating={generating}
            onGenerate={onGenerateBriefing}
          />
          <CourseLoad courses={data.courses} onTab={() => onTab("courses")} />
          <DiscordMini data={data} onTab={() => onTab("settings")} />
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ReactNode;
  tone?: "danger" | "good";
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

function FocusCard({
  assignment,
  index,
}: {
  assignment: Assignment;
  index: number;
}) {
  const due = dueMeta(assignment.dueAt);
  const isOverdue = due.tone === "danger" && due.label.startsWith("Overdue");
  // The pill and meta row already show the due date and points; only surface
  // the reasons that add information (stakes, missing, etc.).
  const reasonChips = assignment.priority.reasons
    .filter(
      (reason) =>
        !/^(Due |Overdue|No due date)/.test(reason) &&
        !/^\d+ pts$/.test(reason),
    )
    .slice(0, 2);
  return (
    <article
      className={`focus-card focus-${assignment.priority.category}`}
      style={{ "--course": assignment.courseColor } as CSSProperties}
    >
      <div className="focus-top">
        <span className="focus-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="course-chip">
          <i style={{ background: assignment.courseColor }} />
          {assignment.courseName}
        </span>
        {assignment.isNew ? <span className="badge badge-new">New</span> : null}
        {isOverdue ? <span className="badge badge-danger">Missing</span> : null}
        <span className={`due-pill tone-${due.tone}`}>{due.label}</span>
      </div>

      <div className="focus-body">
        <h3>{assignment.title}</h3>
        {assignment.description ? (
          <p className="focus-desc">{assignment.description}</p>
        ) : null}
      </div>

      <div className="focus-meta">
        <span>{due.exact}</span>
        <span className="meta-divider" />
        <span>{assignment.maxPoints ? `${assignment.maxPoints} pts` : "No points"}</span>
        <span className="meta-divider" />
        <span>{typeLabel(assignment.type)}</span>
        {assignment.materials.length ? (
          <>
            <span className="meta-divider" />
            <span className="meta-icon">
              <Paperclip size={12} />
              {assignment.materials.length}
            </span>
          </>
        ) : null}
      </div>

      <div className="focus-foot">
        {reasonChips.length ? (
          <div className="reason-row">
            {reasonChips.map((reason) => (
              <span className="reason" key={reason}>
                {reason}
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        {assignment.alternateLink ? (
          <a
            className="btn btn-card"
            href={assignment.alternateLink}
            target="_blank"
            rel="noreferrer"
          >
            Open in Classroom
            <ArrowUpRight size={15} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Timeline({
  items,
  now,
  onTab,
}: {
  items: Assignment[];
  now: number;
  onTab: () => void;
}) {
  const groups = useMemo(() => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const map = new Map<
      string,
      { label: string; day: string; sort: number; items: Assignment[] }
    >();

    for (const assignment of items) {
      if (!assignment.dueAt) continue;
      const date = new Date(assignment.dueAt);
      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).getTime();
      const key = String(dayStart);
      if (!map.has(key)) {
        const diff = Math.round((dayStart - todayStart) / DAY);
        const label =
          dayStart < todayStart
            ? "Overdue"
            : diff === 0
              ? "Today"
              : diff === 1
                ? "Tomorrow"
                : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
                    date,
                  );
        map.set(key, {
          label,
          day: String(date.getDate()).padStart(2, "0"),
          sort: dayStart,
          items: [],
        });
      }
      map.get(key)?.items.push(assignment);
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort).slice(0, 5);
  }, [items, now]);

  return (
    <section className="panel timeline-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">The week ahead</p>
          <h2>Next seven days</h2>
        </div>
        <button type="button" className="text-link" onClick={onTab}>
          All work <ArrowRight size={14} />
        </button>
      </div>

      {groups.length ? (
        <div className="timeline">
          {groups.map((group) => (
            <div className="timeline-group" key={group.label + group.day}>
              <div className="timeline-date">
                <span>{group.label}</span>
                <strong>{group.day}</strong>
              </div>
              <div className="timeline-items">
                {group.items.map((assignment) => {
                  const due = dueMeta(assignment.dueAt);
                  return (
                    <a
                      key={assignment.id}
                      className="timeline-row"
                      href={assignment.alternateLink || undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <i
                        className="course-dot"
                        style={{ background: assignment.courseColor }}
                      />
                      <span className="timeline-title">{assignment.title}</span>
                      <span className="timeline-course">
                        {assignment.courseName}
                      </span>
                      <span className={`timeline-due tone-${due.tone}`}>
                        {due.label}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="timeline-empty">
          <CheckCircle2 size={20} />
          <p>No other deadlines in the next seven days.</p>
        </div>
      )}
    </section>
  );
}

function BriefingCard({
  briefing,
  generating,
  onGenerate,
}: {
  briefing: Dashboard["briefing"];
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <section className="panel briefing-panel">
      <div className="panel-head">
        <div className="panel-title">
          <span className="icon-tile">
            <Sparkles size={16} />
          </span>
          <div>
            <p className="eyebrow">The plan</p>
            <h2>Briefing</h2>
          </div>
        </div>
        {briefing ? (
          <span className={`badge ${briefing.source === "ai" ? "badge-ai" : "badge-local"}`}>
            {briefing.source === "ai" ? "AI" : "Local"}
          </span>
        ) : null}
      </div>

      {briefing ? (
        <>
          {briefing.stale ? (
            <p className="briefing-stale">
              <Info size={13} />
              The workload changed since this was written.
            </p>
          ) : null}
          <div className="briefing-scroll markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {briefing.text}
            </ReactMarkdown>
          </div>
          <div className="briefing-foot">
            <span>
              {briefing.source === "ai" ? briefing.model || "AI" : "Priority engine"}
              {" · "}
              {relativeTime(briefing.generatedAt)}
            </span>
            <button
              type="button"
              className="text-link"
              onClick={onGenerate}
              disabled={generating}
            >
              <RefreshCw size={13} className={generating ? "spin" : ""} />
              {generating ? "Writing…" : "Regenerate"}
            </button>
          </div>
          {briefing.warning ? (
            <p className="briefing-warning">{briefing.warning}</p>
          ) : null}
        </>
      ) : (
        <div className="briefing-empty">
          <span className="briefing-empty-icon">
            <WandSparkles size={22} />
          </span>
          <h3>A short plan for what matters.</h3>
          <p>
            Ranked against due dates, points and what&apos;s actually high stakes.
            Generated once, then refreshed when the work changes.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onGenerate}
            disabled={generating}
          >
            <Sparkles size={14} />
            {generating ? "Writing briefing…" : "Write my briefing"}
          </button>
        </div>
      )}
    </section>
  );
}

function CourseLoad({
  courses,
  onTab,
}: {
  courses: Dashboard["courses"];
  onTab: () => void;
}) {
  const sorted = [...courses].sort((a, b) => b.openCount - a.openCount).slice(0, 5);
  const max = Math.max(1, ...sorted.map((course) => course.openCount));

  return (
    <section className="panel course-load">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Balance</p>
          <h2>Course load</h2>
        </div>
        <button type="button" className="text-link" onClick={onTab}>
          Courses <ArrowRight size={14} />
        </button>
      </div>
      {sorted.length ? (
        <div className="load-list">
          {sorted.map((course) => (
            <div className="load-row" key={course.id}>
              <span className="load-abbr" style={{ color: course.color }}>
                {courseAbbr(course.name)}
              </span>
              <div className="load-main">
                <div className="load-label">
                  <span>{course.name}</span>
                  <strong>{course.openCount}</strong>
                </div>
                <div className="load-track">
                  <i
                    style={{
                      width: `${Math.max(4, (course.openCount / max) * 100)}%`,
                      background: course.color,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="quiet-empty">No active courses yet.</p>
      )}
    </section>
  );
}

function DiscordMini({
  data,
  onTab,
}: {
  data: Dashboard;
  onTab: () => void;
}) {
  const { discord } = data;
  return (
    <section className="panel discord-mini">
      <div className="panel-head">
        <div className="panel-title">
          <span className="icon-tile">
            <MessageSquare size={16} />
          </span>
          <div>
            <p className="eyebrow">Everywhere</p>
            <h2>Discord</h2>
          </div>
        </div>
        <span
          className={`badge ${
            discord.ready ? "badge-live" : discord.configured ? "badge-warn" : "badge-quiet"
          }`}
        >
          {discord.ready ? "Live" : discord.configured ? "Offline" : "Not set up"}
        </span>
      </div>
      <p className="discord-copy">
        {discord.ready
          ? `Your daily plan lands in ${
              discord.channelName ? `#${discord.channelName}` : "Discord"
            }. Ask for it anytime with /brief.`
          : "Get your briefing and due dates in Discord with /due, /next and /brief."}
      </p>
      <button type="button" className="text-link" onClick={onTab}>
        {discord.ready ? "Manage bot" : "Set up the bot"} <ArrowRight size={14} />
      </button>
    </section>
  );
}
