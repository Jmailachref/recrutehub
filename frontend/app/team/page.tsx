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

  if (me?.role !== "admin") return <p className="muted">Only admins can manage the team.</p>;

  return (
    <>
      <h1>Team</h1>
      <p className="muted">People at {me.tenant_name} who can sign in.</p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? "" : "inactive"}>
                <td>{u.full_name || "—"}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.id === me.id}
                    onChange={(e) => change(u, { role: e.target.value as User["role"] })}
                  >
                    {Object.entries(roleLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {u.id === me.id ? (
                    <span className="muted">You</span>
                  ) : (
                    <button className="link" onClick={() => change(u, { is_active: !u.is_active })}>
                      {u.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card add-user" onSubmit={add}>
        <h2>Add someone</h2>
        <div className="row">
          <input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input
            type="password"
            placeholder="Temporary password"
            minLength={8}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(roleLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </div>
      </form>
    </>
  );
}
