"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, Candidate, candidateStatusLabel, OfferSummary } from "@/lib/api";

function Candidates() {
  const params = useSearchParams();
  const router = useRouter();
  const offerId = params.get("offer") ?? "";
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<OfferSummary[]>("/api/offers/offers").then(setOffers).catch(() => {});
  }, []);

  useEffect(() => {
    setCandidates(null);
    api<Candidate[]>(`/api/candidates/candidates${offerId ? `?offer_id=${offerId}` : ""}`)
      .then(setCandidates)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load candidates"));
  }, [offerId]);

  const titles = Object.fromEntries(offers.map((o) => [o.id, o.title]));

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
                <th>Email</th>
                {!offerId && <th>Offer</th>}
                <th>Applied</th>
                <th>Status</th>
                <th>CV</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.email}</td>
                  {!offerId && <td>{titles[c.offer_id] ?? "…"}</td>}
                  <td className="num">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>{candidateStatusLabel[c.status]}</td>
                  <td>
                    <a href={`/api/candidates/candidates/${c.id}/cv`} target="_blank" rel="noopener">
                      PDF
                    </a>{" "}
                    <span className="muted small num">{Math.max(1, Math.round(c.cv_size / 1024))} KB</span>
                  </td>
                </tr>
              ))}
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
