export type PriorityCategory = "now" | "week" | "later" | "done";
export type Tab = "overview" | "assignments" | "courses" | "settings";

export interface AssignmentMaterial {
  title: string;
  url: string;
}

export interface AssignmentPriority {
  score: number;
  category: PriorityCategory;
  label: string;
  reasons: string[];
}

export interface Assignment {
  id: string;
  courseworkId?: string;
  courseId: string;
  courseName: string;
  courseSection?: string;
  courseColor: string;
  title: string;
  description: string;
  type: string;
  dueAt: string | null;
  maxPoints: number | null;
  alternateLink: string;
  materials: AssignmentMaterial[];
  submitted: boolean;
  submissionState?: string;
  late: boolean;
  grade?: number | null;
  isNew: boolean;
  status: string;
  priority: AssignmentPriority;
  duePhrase: string;
}

export interface Course {
  id: string;
  name: string;
  section: string;
  color: string;
  assignmentCount: number;
  openCount: number;
  doneCount: number;
  pointsOpen: number;
}

export interface Stats {
  total: number;
  active: number;
  overdue: number;
  dueToday: number;
  due48h: number;
  dueWeek: number;
  done: number;
  newCount: number;
  pointsThisWeek: number;
  completion: number;
}

export interface Briefing {
  text: string;
  source: "ai" | "local";
  generatedAt: string;
  signature: string;
  model?: string | null;
  stale?: boolean;
  warning?: string;
}

export interface DiscordUser {
  id: string;
  tag: string;
  name: string;
  avatar: string;
}

export interface DiscordStatus {
  configured: boolean;
  ready: boolean;
  user: DiscordUser | null;
  channelConfigured: boolean;
  channelName: string;
  commandsRegistered: boolean;
  digestTime: string;
  alerts: boolean;
  error: string;
  inviteUrl: string;
}

export interface Setup {
  cookieSync: boolean;
  aiConfigured: boolean;
  aiModel: string;
  discordConfigured: boolean;
  discordChannelConfigured: boolean;
  digestTime: string;
  alerts: boolean;
  syncIntervalMinutes: number;
  demoMode: boolean;
}

export interface ImportDraft {
  title: string;
  courseName: string;
  dueAt: string | null;
  maxPoints: number | null;
  submitted: boolean;
  missing: boolean;
}

export interface StudyKitSlide {
  heading: string;
  bullets: string[];
}

export interface StudyKit {
  aim?: string;
  flashcards: Array<{ front: string; back: string }>;
  quiz: Array<{
    question: string;
    options: string[];
    answerIndex: number;
    explanation?: string;
  }>;
  slides: StudyKitSlide[];
  qa: Array<{ q: string; a: string }>;
  sources?: string[];
  studyPlan?: string[];
  source?: "ai" | "local";
  model?: string | null;
  cached?: boolean;
}

export interface Profile {
  name: string;
  givenName: string;
  email: string;
  picture: string;
}

export interface GoogleConfig {
  configured: boolean;
  redirectUri: string;
}

export interface Dashboard {
  source: "google" | "demo" | "import";
  connected: boolean;
  profile: Profile | null;
  google: GoogleConfig;
  courses: Course[];
  assignments: Assignment[];
  stats: Stats;
  briefing: Briefing | null;
  fetchedAt: string | null;
  syncError: string | null;
  syncing: boolean;
  setup: Setup;
  discord: DiscordStatus;
  mobileUrls: string[];
  serverTime: string;
}

export interface SyncResult {
  ok: boolean;
  courses: number;
  assignments: number;
  newCount: number;
  fetchedAt: string;
  warnings: string[];
}
