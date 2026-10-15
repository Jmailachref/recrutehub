// Calls the backends through the gateway. The browser sends the auth cookies.
// On a 401 the session is renewed once with the refresh cookie, then the call
// is retried; if that fails too the visitor goes back to the login page.

export type User = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "editor" | "recruiter";
  is_active: boolean;
  tenant_id: string;
  tenant_name: string;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

// One renewal at a time: a refresh token works once, and reusing it signs the user out.
let renewing: Promise<boolean> | null = null;
function renew(): Promise<boolean> {
  renewing ??= send("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (renewing = null), 0));
  return renewing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r = await send(path, init);
  if (r.status === 401 && !path.startsWith("/api/auth/login")) {
    if (await renew()) r = await send(path, init);
    else {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      throw new ApiError(401, "unauthorized", "Signed out");
    }
  }
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body?.error?.code ?? "error", body?.error?.message ?? r.statusText);
  return body as T;
}

export const roleLabel: Record<User["role"], string> = {
  admin: "Admin",
  editor: "Editor",
  recruiter: "Recruiter",
};

export type OfferStatus = "draft" | "active" | "archived";

export type RecipeRow = { language: string; level: number; code_count: number; qcm_count: number };

export type Skill = { language: string; priority: number };

export const priorityLabel: Record<number, string> = {
  1: "Core",
  2: "Important",
  3: "Secondary",
  4: "CV only",
  5: "Bonus",
};

const TOPIC_NAMES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
  sql: "SQL",
  docker: "Docker",
  kubernetes: "Kubernetes",
};
export const topicName = (t: string) => TOPIC_NAMES[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

// How the skill picker groups the question bank's languages and topics.
const TOPIC_GROUPS: Record<string, string> = {
  sql: "Databases",
  docker: "DevOps",
  kubernetes: "DevOps",
  git: "DevOps",
  linux: "DevOps",
};
export const topicGroup = (t: string) => TOPIC_GROUPS[t] ?? "Programming languages";

export type Offer = {
  id: string;
  title: string;
  status: OfferStatus;
  question_count: number;
  question_budget: number;
  description: string;
  public_token: string;
  cv_score_threshold: number;
  weight_theory: number;
  weight_practice: number;
  skills: Skill[];
  recipe: RecipeRow[];
  created_at: string | null;
};

export type OfferSummary = Pick<Offer, "id" | "title" | "status" | "question_count" | "question_budget" | "created_at">;

export type Recipe = {
  rows: (RecipeRow & { stock_code: number; stock_qcm: number; available_levels: number[] })[];
  total: number;
  budget: number;
  warnings: { code: string; message: string; row: number | null; skill: string | null }[];
};

export type Stock = { language: string; level: number; code: number; qcm: number };

export const levelLabel: Record<number, string> = {
  1: "Beginner",
  2: "Intermediate",
  3: "Advanced",
  4: "Expert",
  5: "Master",
};

export const statusLabel: Record<OfferStatus, string> = { draft: "Draft", active: "Open", archived: "Archived" };

export type CandidateStatus = "applied" | "shortlisted" | "invited" | "tested" | "rejected" | "hired";

export type Candidate = {
  id: string;
  offer_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: CandidateStatus;
  cv_size: number;
  // The CV's points: keyword points plus the recruiters' points, no bound.
  cv_score: number | null;
  cv_status: CvStatus | null;
  // Core skills the CV does not show.
  cv_missing: string[];
  created_at: string;
};

export type CvStatus = "queued" | "processing" | "ready" | "unreadable" | "failed";

export const cvStatusLabel: Record<CvStatus, string> = {
  queued: "CV waiting to be read",
  processing: "Reading the CV",
  ready: "CV read",
  unreadable: "CV unreadable",
  failed: "CV could not be read",
};

// One line of an offer's CV grid: the words that show a competence, and its points.
export type Criterion = {
  id: string;
  label: string;
  terms: string[];
  default_synonyms: boolean;
  points_present: number;
  points_absent: number;
};

export type Grid = { version: number; criteria: Criterion[] };

// Boxes are in PDF points from the page's top left corner.
export type Box = { page: number; x0: number; top: number; x1: number; bottom: number };

export type CvLine = { n: number; page: number; section: string; text: string; start: number; end: number; bbox: number[] | null };

export type CriterionResult = { id: string; label: string; found: boolean; points: number; lines: number[]; matched_terms: string[] };

export type CvHighlight = {
  id: string;
  author_ref: string;
  author_name: string;
  mine: boolean;
  quote: string;
  start: number;
  end: number;
  boxes: Box[];
  points: number;
  comment: string | null;
  created_at: string;
};

export type CvReview = {
  status: CvStatus;
  error: string | null;
  pages: number | null;
  ocr_used: boolean | null;
  lines: CvLine[];
  auto: number | null;
  manual: number;
  total: number | null;
  gained: number | null;
  penalties: number | null;
  criteria: CriterionResult[];
  highlights: CvHighlight[];
};

export type HighlightIn = { points: number; comment?: string | null; quote?: string; page?: number; boxes?: Box[]; line?: number };

// Points have no bound: +3, −50, 0.
export const formatPoints = (value: number | null | undefined) => {
  if (value == null) return "—";
  const n = Math.round(value * 10) / 10;
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
};

export const pointsColor = (value: number | null | undefined) => {
  if (value == null || value === 0) return "text-gray-400";
  return value > 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold";
};

export const candidateStatusLabel: Record<CandidateStatus, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  invited: "Invited to the test",
  tested: "Test done",
  rejected: "Rejected",
  hired: "Hired",
};

export type TestStatus = "invited" | "in_progress" | "submitted" | "scored" | "expired";

export type TestSummary = {
  id: string;
  offer_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  status: TestStatus;
  invited_at: string;
  started_at: string | null;
  submitted_at: string | null;
  theory_score: number | null;
  practice_score: number | null;
  total_score: number | null;
};

export type TestAnswer = {
  problem_id: string;
  position: number;
  kind: "code" | "qcm";
  language: string;
  level: number;
  title: string;
  statement: string;
  options: string[] | null;
  correct_choices: number[] | null;
  choices: number[] | null;
  source_code: string | null;
  verdict: string | null;
  score: number | null;
};

export type TestDetail = TestSummary & {
  offer_title: string;
  duration_seconds: number;
  weight_theory: number;
  weight_practice: number;
  answers: TestAnswer[];
};

export const testStatusLabel: Record<TestStatus, string> = {
  invited: "Invited",
  in_progress: "Taking the test",
  submitted: "Being scored",
  scored: "Scored",
  expired: "Link expired",
};

export const verdictLabel: Record<string, string> = {
  accepted: "All tests pass",
  wrong_answer: "Wrong answer",
  compilation_error: "Does not compile",
  runtime_error: "Runtime error",
  time_limit_exceeded: "Too slow",
  memory_limit_exceeded: "Too much memory",
  output_limit_exceeded: "Too much output",
  no_answer: "Not answered",
  correct: "Correct",
  wrong: "Wrong",
};

// Scores are percentages: green from 70, amber from 40.
export const scoreColor = (score: number | null | undefined) => {
  if (score == null) return "text-gray-400";
  if (score >= 70) return "text-green-600 font-semibold";
  if (score >= 40) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
};
