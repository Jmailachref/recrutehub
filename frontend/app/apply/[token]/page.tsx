"use client";

// The public page behind an offer's apply link. No sign-in.
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type PublicOffer = { title: string; description: string };
const MAX_CV_BYTES = 10 * 1024 * 1024;

export default function ApplyPage() {
  const { token } = useParams<{ token: string }>();
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    fetch(`/api/offers/public/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setOffer)
      .catch(() => setClosed(true));
  }, [token]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const cv = form.get("cv") as File | null;
    if (!cv || cv.size === 0) return setError("Attach your CV as a PDF.");
    if (cv.size > MAX_CV_BYTES) return setError("The CV must be 10 MB or less.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/candidates/apply/${encodeURIComponent(token)}`, { method: "POST", body: form });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(r.status === 400 ? "Check your name and email address." : body?.error?.message ?? "Something went wrong.");
      } else setDone(body.message);
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setBusy(false);
  }

  if (closed)
    return (
      <main className="center">
        <div className="card apply">
          <h1>This offer is closed</h1>
          <p className="muted">The link may be wrong, or the company stopped taking applications.</p>
        </div>
      </main>
    );
  if (!offer) return <main className="center muted">Loading…</main>;

  return (
    <main className="apply-page">
      <article className="card apply">
        <p className="muted small">Job offer</p>
        <h1>{offer.title}</h1>
        {offer.description && <p className="description">{offer.description}</p>}
      </article>
      <section className="card apply">
        {done ? (
          <>
            <h2>Thank you</h2>
            <p className="ok">{done}</p>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <h2>Apply</h2>
            <label>
              Full name
              <input name="name" autoComplete="name" maxLength={200} required />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" maxLength={255} required />
            </label>
            <label>
              Phone <span className="muted small">(optional)</span>
              <input name="phone" type="tel" autoComplete="tel" maxLength={40} />
            </label>
            <label>
              CV <span className="muted small">(PDF, 10 MB at most)</span>
              <input name="cv" type="file" accept="application/pdf,.pdf" required />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send my application"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
