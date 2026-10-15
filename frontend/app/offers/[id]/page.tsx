"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  Candidate,
  candidateStatusLabel,
  formatPoints,
  Grid,
  levelLabel,
  Offer,
  pointsColor,
  priorityLabel,
  Recipe,
  scoreColor,
  statusLabel,
  TestSummary,
  testStatusLabel,
  topicName,
} from "@/lib/api";
import { useUser } from "../../AppShell";

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const canWrite = user?.role !== "editor";
  const [offer, setOffer] = useState<Offer | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  // undefined while it loads, null when the CV analyzer cannot be reached.
  const [grid, setGrid] = useState<Grid | null | undefined>(undefined);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [tests, setTests] = useState<Record<string, TestSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, r, c, t] = await Promise.all([
        api<Offer>(`/api/offers/offers/${id}`),
        api<Recipe>(`/api/offers/offers/${id}/recipe`),
        api<Candidate[]>(`/api/candidates/candidates?offer_id=${id}`),
        api<TestSummary[]>(`/api/assessments/sessions?offer_id=${id}`),
      ]);
      setOffer(o);
      setRecipe(r);
      setCandidates(c);
      setTests(Object.fromEntries(t.map((x) => [x.candidate_id, x])));
      // The CV grid lives in the CV analyzer; the page works without it.
      api<Grid>(`/api/offers/offers/${id}/grid`).then(setGrid).catch(() => setGrid(null));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "Offer not found" : "Failed to load offer");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const applyLink = offer && typeof window !== "undefined" ? `${window.location.origin}/apply/${offer.public_token}` : "";

  function copyLink() {
    navigator.clipboard.writeText(applyLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function publish() {
    setActionError("");
    try {
      setOffer(await api<Offer>(`/api/offers/offers/${id}/publish`, { method: "POST" }));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not publish the offer");
    }
  }

  async function invite(c: Candidate) {
    setInviting(c.id);
    setActionError("");
    try {
      await api("/api/assessments/sessions", { method: "POST", body: JSON.stringify({ candidate_id: c.id }) });
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not send the invitation");
    }
    setInviting(null);
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!offer) return null;

  const all = Object.values(tests);
  const stats = [
    { label: "Total", value: candidates.length },
    { label: "Invited", value: all.length },
    { label: "Submitted", value: all.filter((t) => t.status === "submitted" || t.status === "scored").length },
    { label: "Scored", value: all.filter((t) => t.status === "scored").length },
  ];
  // Best test score first, then the most CV points; candidates without either keep their application order.
  const ranked = [...candidates].sort(
    (a, b) =>
      (tests[b.id]?.total_score ?? -1) - (tests[a.id]?.total_score ?? -1) ||
      (b.cv_score ?? -Infinity) - (a.cv_score ?? -Infinity) ||
      0,
  );
  const priorities = Object.fromEntries(offer.skills.map((s) => [s.language, s.priority]));
  const canInvite = user?.role === "admin" || user?.role === "recruiter";
  const badge =
    offer.status === "active" ? "bg-green-100 text-green-700" : offer.status === "draft" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-blue-600 mb-1 inline-block">
            ← Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">{offer.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>{statusLabel[offer.status]}</span>
          </div>
          {offer.description && <p className="text-gray-600 mt-1 text-sm whitespace-pre-line">{offer.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Link
              href={`/offers/${offer.id}/edit`}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:border-blue-400 hover:text-blue-600 transition"
            >
              Edit offer
            </Link>
          )}
          {offer.status === "active" && (
            <button
              onClick={copyLink}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:border-blue-400 hover:text-blue-600 transition"
            >
              {copied ? "Copied!" : "Copy Apply Link"}
            </button>
          )}
          {canWrite && offer.status === "draft" && (
            <button onClick={publish} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
              Publish
            </button>
          )}
        </div>
      </div>
      {offer.status === "active" && (
        <p className="text-xs text-gray-500 mb-4 break-all">
          Apply link: <span className="select-all text-gray-700">{applyLink}</span>
        </p>
      )}
      {offer.status === "draft" && (
        <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4">
          This offer is a draft: publish it to open its apply link.
        </p>
      )}
      {actionError && <p className="text-red-600 text-sm mb-4">{actionError}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{stat.value}</p>
            <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {recipe && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-8">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-800">Test Recipe</h2>
            <span className="text-sm text-gray-500">
              {recipe.total} questions total · QCM {Math.round(offer.weight_theory * 100)}% / Code {Math.round(offer.weight_practice * 100)}%
            </span>
          </div>
          {recipe.rows.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              No questions yet.{" "}
              {canWrite && (
                <Link href={`/offers/${offer.id}/edit`} className="text-blue-600 hover:underline">
                  Set up the test
                </Link>
              )}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">
                <tr>
                  <th className="px-5 py-3 text-left">Language / Skill</th>
                  <th className="px-5 py-3 text-left">Priority</th>
                  <th className="px-5 py-3 text-center">Level</th>
                  <th className="px-5 py-3 text-center">QCM</th>
                  <th className="px-5 py-3 text-center">Code</th>
                  <th className="px-5 py-3 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recipe.rows.map((row) => (
                  <tr key={row.language} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 font-medium text-gray-900">{topicName(row.language)}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {priorities[row.language] ? `P${priorities[row.language]} — ${priorityLabel[priorities[row.language]]}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-center text-gray-600">
                      {row.level} · {levelLabel[row.level]}
                    </td>
                    <td className="px-5 py-3 text-center text-gray-600 tabular-nums">{row.qcm_count}</td>
                    <td className="px-5 py-3 text-center text-gray-600 tabular-nums">{row.code_count}</td>
                    <td className="px-5 py-3 text-center font-semibold text-gray-800 tabular-nums">{row.qcm_count + row.code_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recipe.warnings
            .filter((w) => w.code === "stock_low")
            .map((w, i) => (
              <p key={i} className="px-5 py-2 text-sm text-yellow-800 bg-yellow-50 border-t border-yellow-200">
                ⚠️ {w.message}
              </p>
            ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-800">CV scoring</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              How CVs earn points: each competence found counts once, a missing core skill costs points.
            </p>
          </div>
          {canWrite && (
            <Link href={`/offers/${offer.id}/grid`} className="text-sm text-blue-600 hover:underline whitespace-nowrap">
              Edit the CV scoring →
            </Link>
          )}
        </div>
        {grid === undefined ? (
          <p className="text-gray-400 text-sm text-center py-6">Loading…</p>
        ) : grid === null ? (
          <p className="text-gray-400 text-sm text-center py-6">The CV scoring is not available right now.</p>
        ) : grid.criteria.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">No competence in the CV scoring yet.</p>
        ) : (
          <ul className="px-5 py-4 flex flex-wrap gap-2">
            {grid.criteria.map((c) => (
              <li key={c.id} className="text-xs rounded-full bg-gray-100 text-gray-700 px-2.5 py-1">
                <span className="font-medium">{topicName(c.label)}</span>{" "}
                <span className="text-green-700 tabular-nums">{formatPoints(c.points_present)}</span>
                {c.points_absent < 0 && <span className="text-red-600 tabular-nums"> / {formatPoints(c.points_absent)} if missing</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Candidates</h2>
          <span className="text-sm text-gray-500">{candidates.length} total</span>
        </div>
        {candidates.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-10">No candidates yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">
              <tr>
                <th className="px-5 py-3 text-left">Rank</th>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Email</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">CV Points</th>
                <th className="px-5 py-3 text-right">Final Score</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ranked.map((c, i) => {
                const t = tests[c.id];
                const scored = t?.total_score != null;
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 text-gray-500 tabular-nums">{scored ? i + 1 : "—"}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3 text-gray-600">{c.email}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                        {t ? testStatusLabel[t.status] : candidateStatusLabel[c.status]}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums ${pointsColor(c.cv_score)}`}>
                      <span title={c.cv_missing.length ? `Missing core skills: ${c.cv_missing.map(topicName).join(", ")}` : undefined}>
                        {formatPoints(c.cv_score)}
                      </span>
                      {c.cv_missing.length > 0 && <span className="block text-xs font-normal text-red-600">misses {c.cv_missing.length} core</span>}
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums ${scoreColor(t?.total_score)}`}>
                      {scored ? t.total_score!.toFixed(1) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {!t && canInvite && offer.status !== "archived" && (
                        <button
                          onClick={() => invite(c)}
                          disabled={inviting === c.id}
                          className="text-xs mr-3 px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition"
                        >
                          {inviting === c.id ? "Sending…" : "Invite to test"}
                        </button>
                      )}
                      <Link href={`/offers/${offer.id}/candidates/${c.id}`} className="text-blue-600 hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
