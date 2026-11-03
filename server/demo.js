import { rankAssignments, computeStats } from "./priority.js";

const COURSES = [
  { id: "demo-bio", name: "AP Biology", section: "Period 2", color: "#7ee0a3" },
  { id: "demo-calc", name: "Calculus II", section: "Period 4", color: "#7fc9ff" },
  { id: "demo-eng", name: "English Literature", section: "Period 1", color: "#ffc46b" },
  { id: "demo-hist", name: "World History", section: "Period 5", color: "#ff9aa8" },
  { id: "demo-cs", name: "Computer Science A", section: "Period 6", color: "#c0a6ff" },
];

function dueAt(dayOffset, hours = 23, minutes = 59, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function build(now) {
  const make = (assignment) => ({
    description: "",
    type: "ASSIGNMENT",
    state: "PUBLISHED",
    maxPoints: null,
    submitted: false,
    submissionState: "NEW",
    late: false,
    alternateLink: "https://classroom.google.com/",
    materials: [],
    isNew: false,
    ...assignment,
    course: COURSES.find((course) => course.id === assignment.courseId),
  });

  const raw = [
    make({
      id: "demo-1",
      courseId: "demo-calc",
      title: "Problem set 9 — series & convergence",
      description:
        "Complete problems 1–18. Show the test you used for each series; answers without justification get half credit.",
      dueAt: dueAt(0, 22, 0, now),
      maxPoints: 40,
      isNew: true,
    }),
    make({
      id: "demo-2",
      courseId: "demo-eng",
      title: "Essay: symbolism in The Great Gatsby",
      description:
        "1,200 words minimum, MLA format. Submit the outline by tomorrow even if the essay is not finished.",
      dueAt: dueAt(2, 23, 59, now),
      maxPoints: 100,
      isNew: true,
    }),
    make({
      id: "demo-3",
      courseId: "demo-hist",
      title: "Unit exam: Cold War",
      description:
        "Covers chapters 26–29 and the primary-source packet. Bring a blue or black pen.",
      dueAt: dueAt(1, 8, 30, now),
      maxPoints: 100,
    }),
    make({
      id: "demo-4",
      courseId: "demo-bio",
      title: "Lab report: cellular respiration",
      description:
        "Graph your group's CO₂ data, calculate the rate for each condition, and write the conclusion section.",
      dueAt: dueAt(1, 23, 59, now),
      maxPoints: 60,
      isNew: true,
    }),
    make({
      id: "demo-5",
      courseId: "demo-cs",
      title: "AP practice FRQ set",
      description: "Timed practice: 45 minutes, questions 1 and 2 only.",
      dueAt: dueAt(2, 9, 0, now),
      maxPoints: 30,
    }),
    make({
      id: "demo-6",
      courseId: "demo-hist",
      title: "DBQ practice — containment",
      description: "Use at least four documents in your response.",
      dueAt: dueAt(-1, 23, 59, now),
      maxPoints: 50,
      late: true,
    }),
    make({
      id: "demo-7",
      courseId: "demo-bio",
      title: "Quiz: photosynthesis",
      description: "Open-note quiz on the light reactions and Calvin cycle.",
      dueAt: dueAt(3, 10, 15, now),
      maxPoints: 25,
    }),
    make({
      id: "demo-8",
      courseId: "demo-eng",
      title: "Presentation: modern poetry",
      description: "Five minutes, one poem, one clear argument. Slides optional.",
      dueAt: dueAt(5, 12, 0, now),
      maxPoints: 80,
    }),
    make({
      id: "demo-9",
      courseId: "demo-calc",
      title: "Midterm 2 review packet",
      description: "Optional but strongly recommended. Answer key posted Friday.",
      dueAt: dueAt(6, 23, 59, now),
      maxPoints: 0,
    }),
    make({
      id: "demo-10",
      courseId: "demo-cs",
      title: "Final project proposal",
      description:
        "One page: problem statement, planned classes, three test cases. Upload as a PDF.",
      dueAt: dueAt(9, 23, 59, now),
      maxPoints: 50,
      isNew: true,
    }),
    make({
      id: "demo-11",
      courseId: "demo-bio",
      title: "Reading: chapter 12",
      description: "Annotate the section on electron transport.",
      dueAt: dueAt(2, 8, 0, now),
      maxPoints: 10,
      submitted: true,
      submissionState: "TURNED_IN",
    }),
    make({
      id: "demo-12",
      courseId: "demo-calc",
      title: "Worksheet: convergence tests",
      description: "",
      dueAt: dueAt(-6, 23, 59, now),
      maxPoints: 20,
      submitted: true,
      submissionState: "TURNED_IN",
    }),
    make({
      id: "demo-13",
      courseId: "demo-eng",
      title: "Independent reading check-in",
      description: "Tell Mr. Alvarez what you're reading this month.",
      dueAt: null,
      maxPoints: 5,
    }),
  ];

  return raw.map((assignment) => ({
    ...assignment,
    courseName: assignment.course.name,
    courseColor: assignment.course.color,
    courseSection: assignment.course.section,
    course: undefined,
  }));
}

/** Dashboard-shaped sample data so the app is usable before Google is linked. */
export function getDemoDashboard(now = Date.now()) {
  const assignments = build(new Date(now));
  const ranked = rankAssignments(assignments, now);
  const courses = COURSES.map((course) => {
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
  return {
    courses,
    assignments: ranked,
    stats: computeStats(ranked, now),
    fetchedAt: new Date(now).toISOString(),
  };
}
