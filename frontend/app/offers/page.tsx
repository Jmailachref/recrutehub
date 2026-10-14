"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Offer, OfferSummary, statusLabel } from "@/lib/api";
import { useUser } from "../AppShell";

export default function OffersPage() {
  const user = useUser();
  const router = useRouter();
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const canWrite = user?.role !== "editor";

  useEffect(() => {
    api<OfferSummary[]>("/api/offers/offers").then(setOffers).catch((e) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const offer = await api<Offer>("/api/offers/offers", { method: "POST", body: JSON.stringify({ title }) });
      router.push(`/offers/${offer.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the offer");
    }
  }

  return (
    <>
      <h1>Offers</h1>
      <p className="muted">Each offer has its own apply link and its own test.</p>
      {error && <p className="error">{error}</p>}
      {canWrite && (
        <form className="card add-user" onSubmit={create}>
          <div className="row">
            <input placeholder="Job title, e.g. Backend developer" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit">New offer</button>
          </div>
        </form>
      )}
      {offers && offers.length === 0 && <p className="muted">No offers yet.</p>}
      {offers && offers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Questions</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className={o.status === "archived" ? "inactive" : ""}>
                  <td>
                    <Link href={`/offers/${o.id}`}>{o.title}</Link>
                  </td>
                  <td>
                    <span className={`status status-${o.status}`}>{statusLabel[o.status]}</span>
                  </td>
                  <td className="num">
                    {o.question_count} / {o.question_budget}
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
