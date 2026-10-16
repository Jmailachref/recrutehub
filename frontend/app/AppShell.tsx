"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, roleLabel, User } from "@/lib/api";

const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/library", label: "Library" },
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

  if (!user) {
    return <div className="min-h-screen bg-gray-50 p-8 text-gray-500">Loading…</div>;
  }

  return (
    <UserContext.Provider value={user}>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href="/dashboard" className="text-lg font-bold text-blue-600">
              RecruteHub
            </Link>
            <span className="text-sm text-gray-400">{user.tenant_name}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-4">
            {NAV.filter((item) => !item.adminOnly || user.role === "admin").map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm ${pathname.startsWith(item.href) ? "text-gray-900 font-medium" : "text-gray-600 hover:text-gray-900"}`}
              >
                {item.label}
              </Link>
            ))}
            {user.role !== "editor" && (
              <Link href="/offers/new" className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
                New Offer
              </Link>
            )}
            <span className="text-sm text-gray-400">
              {user.full_name || user.email} · {roleLabel[user.role]}
            </span>
            <button onClick={signOut} className="text-sm text-gray-500 hover:text-red-600 transition">
              Logout
            </button>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
