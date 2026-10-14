"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, roleLabel, User } from "@/lib/api";
import { useUser } from "../AppShell";

export default function TeamPage() {
  const me = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "recruiter" });

  const load = () => api<User[]>("/api/auth/users").then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/auth/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ email: "", full_name: "", password: "", role: "recruiter" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the user");
    }
  }

  async function change(user: User, patch: Partial<User>) {
    setError("");
    try {
      await api(`/api/auth/users/${user.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the user");
    }
  }

  if (me?.role !== "admin") return <p className="text-gray-500">Only admins can manage the team.</p>;

  const field = "border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800">Team</h1>
      <p className="text-gray-500 text-sm mt-1 mb-6">People at {me.tenant_name} who can sign in.</p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Role</th>
              <th className="px-5 py-3 text-right">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? "hover:bg-gray-50" : "text-gray-400"}>
                <td className="px-5 py-3 font-medium">{u.full_name || "—"}</td>
                <td className="px-5 py-3">{u.email}</td>
                <td className="px-5 py-3">
                  <select
                    value={u.role}
                    disabled={u.id === me.id}
                    onChange={(e) => change(u, { role: e.target.value as User["role"] })}
                    className="border border-gray-300 rounded px-1 py-0.5 text-sm bg-white disabled:opacity-60"
                  >
                    {Object.entries(roleLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3 text-right">
                  {u.id === me.id ? (
                    <span className="text-gray-400 text-xs">You</span>
                  ) : (
                    <button
                      onClick={() => change(u, { is_active: !u.is_active })}
                      className={`text-xs ${u.is_active ? "text-red-500 hover:underline" : "text-blue-600 hover:underline"}`}
                    >
                      {u.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="bg-white rounded-xl border border-gray-200 shadow-sm p-6" onSubmit={add}>
        <h2 className="font-semibold text-gray-800 mb-4">Add someone</h2>
        <div className="flex flex-wrap gap-3">
          <input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={`${field} flex-1 min-w-40`} />
          <input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${field} flex-1 min-w-40`} />
          <input
            type="password"
            placeholder="Temporary password"
            minLength={8}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={`${field} flex-1 min-w-40`}
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={field}>
            {Object.entries(roleLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
