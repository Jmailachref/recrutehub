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
  recipe: RecipeRow[];
};

export type OfferSummary = Pick<Offer, "id" | "title" | "status" | "question_count" | "question_budget">;

export type Recipe = {
  rows: (RecipeRow & { stock_code: number; stock_qcm: number; available_levels: number[] })[];
  total: number;
  budget: number;
  warnings: { code: string; message: string; row: number | null }[];
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
