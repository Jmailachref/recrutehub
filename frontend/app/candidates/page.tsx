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
  scoreColor,
  TestSummary,
  testStatusLabel,
} from "@/lib/api";

function score(t: TestSummary | undefined): string {
  return t?.total_score != null ? t.total_score.toFixed(1) : "—";
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
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Candidates</h1>
        <select
          value={offerId}
          onChange={(e) => router.replace(e.target.value ? `/candidates?offer=${e.target.value}` : "/candidates")}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All offers</option>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {!candidates ? (
        !error && <p className="text-gray-500">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-center py-16 text-gray-500">No applications yet. Share an open offer&apos;s apply link to get some.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                {!offerId && <th className="px-5 py-3 text-left">Offer</th>}
                <th className="px-5 py-3 text-left">Applied</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Final Score</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => {
                const t = tests[c.id];
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <div className="text-xs text-gray-500">{c.email}</div>
                    </td>
                    {!offerId && (
                      <td className="px-5 py-3 text-gray-600">
                        <Link href={`/offers/${c.offer_id}`} className="hover:text-blue-600">
                          {titles[c.offer_id] ?? "…"}
                        </Link>
                      </td>
                    )}
                    <td className="px-5 py-3 text-gray-600 tabular-nums">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                        {t ? testStatusLabel[t.status] : candidateStatusLabel[c.status]}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums ${scoreColor(t?.total_score)}`}>{score(t)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {!t && canInvite && (
                        <button
                          onClick={() => invite(c)}
                          disabled={inviting === c.id}
                          className="text-xs mr-3 px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition"
                        >
                          {inviting === c.id ? "Sending…" : "Invite to test"}
                        </button>
                      )}
                      <Link href={`/offers/${c.offer_id}/candidates/${c.id}`} className="text-blue-600 hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CandidatesPage() {
  return (
    <Suspense>
      <Candidates />
    </Suspense>
  );
}
