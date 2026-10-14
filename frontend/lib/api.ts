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
  cv_score: number | null;
  created_at: string;
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
