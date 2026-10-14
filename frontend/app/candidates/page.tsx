"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "../AppShell";
import {
  api,
  ApiError,
  Candidate,
  candidateStatusLabel,
  OfferSummary,
  TestSummary,
  testStatusLabel,
} from "@/lib/api";

function score(t: TestSummary | undefined): string {
  return t?.total_score != null ? `${Math.round(t.total_score)}%` : "";
}

function Candidates() {
  const user = useUser();
  const canInvite = user?.role === "admin" || user?.role === "recruiter";
  const params = useSearchParams();
  const router = useRouter();
  const offerId = params.get("offer") ?? "";
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [tests, setTests] = useState<Record<string, TestSummary>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<OfferSummary[]>("/api/offers/offers").then(setOffers).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const q = offerId ? `?offer_id=${offerId}` : "";
    return Promise.all([
      api<Candidate[]>(`/api/candidates/candidates${q}`),
      api<TestSummary[]>(`/api/assessments/sessions${q}`),
    ])
      .then(([c, t]) => {
        setCandidates(c);
        setTests(Object.fromEntries(t.map((x) => [x.candidate_id, x])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load candidates"));
  }, [offerId]);

  useEffect(() => {
    setCandidates(null);
    load();
  }, [load]);

  async function invite(c: Candidate) {
    setInviting(c.id);
    setError("");
    try {
      await api("/api/assessments/sessions", { method: "POST", body: JSON.stringify({ candidate_id: c.id }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the invitation");
    }
    setInviting(null);
  }

  const titles = Object.fromEntries(offers.map((o) => [o.id, o.title]));
  // Best score first; candidates without a score keep their application order.
  const rows = [...(candidates ?? [])].sort(
    (a, b) => (tests[b.id]?.total_score ?? -1) - (tests[a.id]?.total_score ?? -1),
  );

  return (
    <>
      <div className="title-row">
        <h1>Candidates</h1>
        <span className="spacer" />
        <select value={offerId} onChange={(e) => router.replace(e.target.value ? `/candidates?offer=${e.target.value}` : "/candidates")}>
          <option value="">All offers</option>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {!candidates ? (
        !error && <p className="muted">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="muted">No applications yet. Share an open offer&apos;s apply link to get some.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {!offerId && <th>Offer</th>}
                <th>Applied</th>
                <th>Status</th>
                <th>CV</th>
                <th>Test</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const t = tests[c.id];
                return (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <div className="muted small">{c.email}</div>
                    </td>
                    {!offerId && <td>{titles[c.offer_id] ?? "…"}</td>}
                    <td className="num">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>{candidateStatusLabel[c.status]}</td>
                    <td>
                      <a href={`/api/candidates/candidates/${c.id}/cv`} target="_blank" rel="noopener">
                        PDF
                      </a>
                    </td>
                    <td>
                      {t ? (
                        <Link href={`/tests/${t.id}`}>{testStatusLabel[t.status]}</Link>
                      ) : canInvite ? (
                        <button className="secondary" onClick={() => invite(c)} disabled={inviting === c.id}>
                          {inviting === c.id ? "Sending…" : "Invite to test"}
                        </button>
                      ) : (
                        <span className="muted">Not invited</span>
                      )}
                    </td>
                    <td className="num score">{score(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function CandidatesPage() {
  return (
    <Suspense>
      <Candidates />
    </Suspense>
  );
}
