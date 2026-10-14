// Guards the recruiter pages on the server, before any page code runs.
// A valid rh_access cookie passes. An expired one is renewed with the
// rh_refresh cookie by calling auth directly; otherwise the visitor is sent
// to /login and brought back after signing in.
import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_URL = process.env.AUTH_INTERNAL_URL ?? "http://auth:8000";
const jwks = createRemoteJWKSet(new URL(`${AUTH_URL}/jwks`));

const STAFF_ROLES = ["admin", "editor", "recruiter"];

async function signedIn(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: "recrutehub-auth", algorithms: ["RS256"] });
    return STAFF_ROLES.includes(String(payload.role));
  } catch {
    return false;
  }
}

async function renew(request: NextRequest): Promise<string[] | null> {
  const refresh = request.cookies.get("rh_refresh")?.value;
  if (!refresh) return null;
  try {
    const r = await fetch(`${AUTH_URL}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    return r.ok ? r.headers.getSetCookie() : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const onLogin = pathname === "/login";

  if (await signedIn(request.cookies.get("rh_access")?.value)) {
    return onLogin ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  const cookies = await renew(request);
  if (cookies) {
    const response = onLogin ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  }
  if (onLogin) return NextResponse.next();
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/", "/login", "/dashboard/:path*", "/offers/:path*", "/candidates/:path*", "/team/:path*"],
};
