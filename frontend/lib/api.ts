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
