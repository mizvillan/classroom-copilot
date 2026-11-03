import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Download,
  FileText,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { studyKit } from "../api";
import type { Assignment, StudyKit as StudyKitData } from "../types";

type Props = {
  assignment: Assignment | null;
  aiConfigured: boolean;
  onClose: () => void;
};

const TABS = [
  { id: "cards", label: "Flashcards", icon: Layers },
  { id: "quiz", label: "Quiz", icon: BookOpenCheck },
  { id: "slides", label: "Slides", icon: FileText },
  { id: "qa", label: "Q&A", icon: Sparkles },
  { id: "plan", label: "Plan", icon: Zap },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function StudyKitModal({ assignment, aiConfigured, onClose }: Props) {
  const [kit, setKit] = useState<StudyKitData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("cards");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!assignment) return;
    let cancelled = false;
    setKit(null);
    setError(null);
    setTab("cards");
    setAnswers({});
    setFlipped({});
    setLoading(true);
    studyKit(assignment.id)
      .then((next) => {
        if (!cancelled) setKit(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not build the study kit.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignment]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const score = useMemo(() => {
    if (!kit) return { correct: 0, total: 0 };
    const correct = kit.quiz.reduce(
      (sum, item, index) => (answers[index] === item.answerIndex ? sum + 1 : sum),
      0,
    );
    return { correct, total: kit.quiz.length };
  }, [answers]);

  if (!assignment) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        className="panel modal study-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Study kit for ${assignment.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">Study kit</p>
            <h2>{assignment.title}</h2>
            <p className="modal-sub">
              {assignment.courseName}
              {assignment.duePhrase ? ` · ${assignment.duePhrase}` : ""}
              {assignment.maxPoints ? ` · ${assignment.maxPoints} pts` : ""}
            </p>
          </div>
          <div className="modal-head-actions">
            {kit?.source ? (
              <span className={`pill ${kit.source === "ai" ? "pill-good" : "pill-quiet"}`}>
                {kit.source === "ai" ? "AI generated" : "Local build"}
              </span>
            ) : null}
            {kit ? (
              <a
                className="icon-btn"
                href={`/api/study/download?id=${encodeURIComponent(assignment.id)}`}
                aria-label="Download study kit as Markdown"
                title="Download as Markdown"
              >
                <Download size={16} />
              </a>
            ) : null}
            {kit && aiConfigured ? (
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setKit(null);
                  setLoading(true);
                  studyKit(assignment.id, true)
                    .then(setKit)
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : "Regeneration failed."),
                    )
                    .finally(() => setLoading(false));
                }}
                aria-label="Regenerate study kit"
                title="Regenerate with AI"
              >
                <RefreshCw size={16} />
              </button>
            ) : null}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        <nav className="study-tabs" aria-label="Study kit sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "is-active" : ""}
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="modal-body">
          {loading ? (
            <div className="study-loading">
              <Loader2 size={22} className="spin" />
              <p>Building your study kit…</p>
            </div>
          ) : error ? (
            <div className="study-loading">
              <p className="inline-warning">{error}</p>
            </div>
          ) : !kit ? null : tab === "cards" ? (
            <div className="flash-grid">
              {kit.flashcards.map((card, index) => (
                <button
                  key={index}
                  type="button"
                  className={`flash-card${flipped[index] ? " is-flipped" : ""}`}
                  onClick={() => setFlipped((prev) => ({ ...prev, [index]: !prev[index] }))}
                  aria-pressed={Boolean(flipped[index])}
                >
                  <span className="flash-label">{flipped[index] ? "Answer" : "Question"}</span>
                  <span className="flash-text">{flipped[index] ? card.back : card.front}</span>
                </button>
              ))}
            </div>
          ) : tab === "quiz" ? (
            <div className="quiz-list">
              <div className="quiz-score">
                {score.correct}/{score.total} answered correctly
              </div>
              {kit.quiz.map((item, index) => {
                const picked = answers[index];
                return (
                  <fieldset key={index} className="quiz-item">
                    <legend>
                      {index + 1}. {item.question}
                    </legend>
                    <div className="quiz-options">
                      {item.options.map((option, optionIndex) => {
                        const isAnswer = optionIndex === item.answerIndex;
                        const isPicked = picked === optionIndex;
                        const state =
                          picked === undefined
                            ? ""
                            : isAnswer
                              ? "is-right"
                              : isPicked
                                ? "is-wrong"
                                : "";
                        return (
                          <button
                            key={optionIndex}
                            type="button"
                            className={`quiz-option ${state}`}
                            onClick={() => setAnswers((prev) => ({ ...prev, [index]: optionIndex }))}
                            disabled={picked !== undefined}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    {picked !== undefined && item.explanation ? (
                      <p className="quiz-why">{item.explanation}</p>
                    ) : null}
                  </fieldset>
                );
              })}
            </div>
          ) : tab === "slides" ? (
            <div className="slide-outline">
              {kit.slides.map((slide, index) => (
                <section key={index} className="slide-block">
                  <p className="slide-number">Slide {index + 1}</p>
                  <h3>{slide.heading}</h3>
                  <ul>
                    {(slide.bullets || []).map((bullet, bIndex) => (
                      <li key={bIndex}>{bullet}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : tab === "qa" ? (
            <div className="qa-list">
              {kit.qa.map((item, index) => (
                <div key={index} className="qa-item">
                  <p className="qa-q">{item.q}</p>
                  <p className="qa-a">{item.a}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="plan-block">
              {kit.aim ? <p className="plan-aim">{kit.aim}</p> : null}
              <ol className="steps">
                {(kit.studyPlan || []).map((step, index) => (
                  <li key={index}>
                    <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <p>{step}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {kit.sources?.length ? (
                <p className="privacy-note">
                  Sources: {kit.sources.join(" · ")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
