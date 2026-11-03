import type { CSSProperties } from "react";
import { ArrowUpRight, BookOpen, CheckCircle2 } from "lucide-react";

import type { Assignment, Dashboard } from "../types";
import { courseAbbr, dueMeta, plural } from "../lib/format";

type Props = {
  data: Dashboard;
  onSelectCourse: (courseId: string) => void;
};

function nextFor(courseId: string, assignments: Assignment[]): Assignment | undefined {
  return assignments.find(
    (assignment) => assignment.courseId === courseId && !assignment.submitted,
  );
}

export function Courses({ data, onSelectCourse }: Props) {
  const sorted = [...data.courses].sort((a, b) => b.openCount - a.openCount);

  return (
    <div className="view">
      <section className="page-head">
        <div>
          <p className="eyebrow">The full picture</p>
          <h1>Courses</h1>
          <p className="page-sub">
            {data.courses.length} {plural(data.courses.length, "course")} ·{" "}
            {data.stats.active} open {plural(data.stats.active, "task")} ·{" "}
            {data.stats.pointsThisWeek} points due this week.
          </p>
        </div>
      </section>

      {sorted.length ? (
        <div className="course-grid">
          {sorted.map((course) => {
            const next = nextFor(course.id, data.assignments);
            const nextDue = next ? dueMeta(next.dueAt) : null;
            const doneShare = course.assignmentCount
              ? Math.round((course.doneCount / course.assignmentCount) * 100)
              : 0;
            return (
              <button
                key={course.id}
                type="button"
                className="course-card"
                style={{ "--course": course.color } as CSSProperties}
                onClick={() => onSelectCourse(course.id)}
              >
                <div className="course-card-top">
                  <span className="course-avatar">{courseAbbr(course.name)}</span>
                  <span className="course-open-arrow">
                    <ArrowUpRight size={16} />
                  </span>
                </div>
                <h2>{course.name}</h2>
                <p className="course-section">
                  {course.section || "Google Classroom"}
                  {course.pointsOpen > 0 ? ` · ${course.pointsOpen} pts open` : ""}
                </p>

                <div className="course-numbers">
                  <div>
                    <strong>{course.openCount}</strong>
                    <span>Open</span>
                  </div>
                  <div>
                    <strong>{course.doneCount}</strong>
                    <span>Turned in</span>
                  </div>
                  <div>
                    <strong>{doneShare}%</strong>
                    <span>Complete</span>
                  </div>
                </div>

                <div className="course-progress" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, doneShare)}%` }} />
                </div>

                <div className="course-next">
                  {next ? (
                    <>
                      <span className="course-next-label">
                        <BookOpen size={13} /> Next up
                      </span>
                      <span className="course-next-title">{next.title}</span>
                      <span className={`course-next-due tone-${nextDue?.tone}`}>
                        {nextDue?.label}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="course-next-label">
                        <CheckCircle2 size={13} /> Caught up
                      </span>
                      <span className="course-next-title">
                        No open work in this course.
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="panel empty-panel empty-large">
          <span className="empty-icon">
            <BookOpen size={24} />
          </span>
          <h3>No active courses yet.</h3>
          <p>
            Once Classroom is connected, every active course and its workload
            shows up here.
          </p>
        </div>
      )}
    </div>
  );
}
