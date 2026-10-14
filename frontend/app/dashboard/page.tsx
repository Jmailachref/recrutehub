"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, Candidate, OfferSummary, statusLabel, TestSummary } from "@/lib/api";
import { useUser } from "../AppShell";

type Tab = "active" | "archived";
type Card = OfferSummary & { total_candidates: number; scored_candidates: number };

export default function DashboardPage() {
  const user = useUser();
  const canWrite = user?.role !== "editor";
  const [tab, setTab] = useState<Tab>("active");
  const [offers, setOffers] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, candidates, tests] = await Promise.all([
        api<OfferSummary[]>("/api/offers/offers"),
        api<Candidate[]>("/api/candidates/candidates"),
        api<TestSummary[]>("/api/assessments/sessions"),
      ]);
      setOffers(
        list.map((o) => ({
          ...o,
          total_candidates: candidates.filter((c) => c.offer_id === o.id).length,
          scored_candidates: tests.filter((t) => t.offer_id === o.id && t.status === "scored").length,
        })),
      );
    } catch {
      setError("Failed to load offers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function setStatus(offer: Card, action: "archive" | "restore") {
    setPendingId(offer.id);
    try {
      const saved = await api<OfferSummary>(`/api/offers/offers/${offer.id}/${action}`, { method: "POST" });
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: saved.status } : o)));
      if (action === "restore") showToast(`"${offer.title}" is back as a draft. Publish it to reopen the apply link.`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(offer: Card) {
    const confirmed = window.confirm(`Delete "${offer.title}" permanently?\n\nThis cannot be undone.`);
    if (!confirmed) return;
    setPendingId(offer.id);
    try {
      await api(`/api/offers/offers/${offer.id}`, { method: "DELETE" });
      setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Failed to delete offer");
    } finally {
      setPendingId(null);
    }
  }

  const shown = offers.filter((o) => (tab === "archived" ? o.status === "archived" : o.status !== "archived"));
  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      tab === t ? "bg-white shadow-sm text-gray-900 border border-gray-200" : "text-gray-500 hover:text-gray-700"
    }`;

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 max-w-sm bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Job Offers</h1>
        {canWrite && (
          <Link
            href="/offers/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
          >
            + New Offer
          </Link>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        <button className={tabCls("active")} onClick={() => setTab("active")}>
          Active
        </button>
        <button className={tabCls("archived")} onClick={() => setTab("archived")}>
          Archived
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {!loading && !error && shown.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          {tab === "active" ? (
            <>
              <p className="text-lg">No active offers.</p>
              {canWrite && (
                <Link href="/offers/new" className="text-blue-600 hover:underline mt-2 inline-block">
                  Create your first offer
                </Link>
              )}
            </>
          ) : (
            <p className="text-lg">No archived offers.</p>
          )}
        </div>
      )}

      {!loading && shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((offer) => {
            const busy = pendingId === offer.id;
            const isArchived = offer.status === "archived";
            return (
              <div
                key={offer.id}
                className={`rounded-xl border p-5 flex flex-col ${
                  isArchived ? "bg-gray-50 border-gray-200 opacity-80" : "bg-white border-gray-200 shadow-sm"
                }`}
              >
                <Link href={`/offers/${offer.id}`} className="block flex-1 hover:opacity-80 transition">
                  <OfferCardBody offer={offer} muted={isArchived} />
                </Link>

                {canWrite && (
                  <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    {isArchived ? (
                      <button
                        onClick={() => setStatus(offer, "restore")}
                        disabled={busy}
                        className="flex-1 text-xs py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-40"
                      >
                        {busy ? "…" : "Restore"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(offer, "archive")}
                        disabled={busy}
                        className="flex-1 text-xs py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-yellow-400 hover:text-yellow-700 transition disabled:opacity-40"
                      >
                        {busy ? "…" : "Archive"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(offer)}
                      disabled={busy || offer.total_candidates > 0}
                      title={offer.total_candidates > 0 ? "Offers with candidates can only be archived" : undefined}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-400 transition disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {busy ? "…" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OfferCardBody({ offer, muted = false }: { offer: Card; muted?: boolean }) {
  const badge =
    offer.status === "active"
      ? "bg-green-100 text-green-700"
      : offer.status === "draft"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-gray-100 text-gray-500";
  return (
    <>
      <div className="flex items-start justify-between mb-3">
        <h2 className={`font-semibold leading-tight ${muted ? "text-gray-500" : "text-gray-900"}`}>{offer.title}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 shrink-0 ${badge}`}>{statusLabel[offer.status]}</span>
      </div>
      <div className={`flex gap-4 text-sm ${muted ? "text-gray-400" : "text-gray-600"}`}>
        <span>
          <span className={`font-semibold ${muted ? "text-gray-500" : "text-gray-900"}`}>{offer.total_candidates}</span> candidates
        </span>
        <span>
          <span className={`font-semibold ${muted ? "text-gray-500" : "text-gray-900"}`}>{offer.scored_candidates}</span> scored
        </span>
        <span>
          <span className={`font-semibold ${muted ? "text-gray-500" : "text-gray-900"}`}>{offer.question_count}</span> questions
        </span>
      </div>
      {offer.created_at && <p className="text-xs mt-2 text-gray-400">{new Date(offer.created_at).toLocaleDateString()}</p>}
    </>
  );
}
