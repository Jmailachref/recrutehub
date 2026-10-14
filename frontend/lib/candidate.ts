// Calls the assessments service as the candidate, with the token from their test link.

export type Question = {
  id: string;
  position: number;
  kind: "code" | "qcm";
  language: string;
  level: number;
  title: string;
  statement: string;
  timer_seconds: number;
  starter_code: string | null;
  choices: string[] | null;
  multiple: boolean;
  examples: { name: string; input: string; expected_output: string }[];
  hidden_tests: number;
  answer_choices: number[] | null;
  answer_source: string | null;
};

export type MyTest = {
  status: "invited" | "in_progress" | "submitted" | "scored" | "expired";
  candidate_name: string;
  offer_title: string;
  duration_seconds: number;
  question_count: number;
  code_count: number;
  qcm_count: number;
  deadline: string | null;
  seconds_left: number | null;
  questions: Question[];
};

export type Run = {
  id: string;
  status: string;
  verdict: string | null;
  stdout: string;
  stderr: string;
  compile_output: string;
  time_ms: number | null;
};

export class TestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const KEY = "rh_test_token";

// The link carries the token in its #fragment, which never reaches a server.
// Keep it for this tab so a reload still works, and take it out of the address bar.
export function takeToken(): string | null {
  const fromLink = window.location.hash.slice(1);
  if (fromLink) {
    try {
      sessionStorage.setItem(KEY, fromLink);
    } catch {}
    history.replaceState(null, "", window.location.pathname);
    return fromLink;
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api/assessments${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new TestError(r.status, body?.error?.code ?? "error", body?.error?.message ?? r.statusText);
  return body as T;
}
