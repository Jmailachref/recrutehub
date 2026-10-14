"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, roleLabel, User } from "@/lib/api";

const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/team", label: "Team", adminOnly: true },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    api<User>("/api/auth/me").then(setUser).catch(() => {});
  }, []);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  if (!user) return <main className="center muted">Loading…</main>;

  return (
    <UserContext.Provider value={user}>
      <header className="topbar">
        <strong className="brand">RecruteHub</strong>
        <span className="muted">{user.tenant_name}</span>
        <nav>
          {NAV.filter((item) => !item.adminOnly || user.role === "admin").map((item) => (
            <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""}>
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted">
          {user.full_name || user.email} · {roleLabel[user.role]}
        </span>
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="page">{children}</main>
    </UserContext.Provider>
  );
}
