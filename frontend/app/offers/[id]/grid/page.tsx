"use client";

// The offer's CV scoring on its own: for each competence, the words that show it
// in a CV and the points it is worth. Saving scores every CV of the offer again.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CvGridEditor, { criteriaOf, GridRow, rowsFrom } from "@/components/CvGridEditor";
import { api, ApiError, Grid, Offer } from "@/lib/api";
import { useUser } from "../../../AppShell";

export default function GridPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function show(grid: Grid, o: Offer) {
    const next = rowsFrom(grid.criteria, Object.fromEntries(o.skills.map((s) => [s.language, s.priority])));
    setRows(next);
    setSaved(JSON.stringify(next));
  }

  useEffect(() => {
    Promise.all([api<Offer>(`/api/offers/offers/${id}`), api<Grid>(`/api/offers/offers/${id}/grid`)])
      .then(([o, g]) => {
        setOffer(o);
        show(g, o);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the CV scoring"))
      .finally(() => setLoading(false));
  }, [id]);

  if (user?.role === "editor") return <p className="text-gray-500">Editors can read offers but not change them.</p>;
  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!offer) return <p className="text-red-600">{error}</p>;

  async function put(body: object, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      show(await api<Grid>(`/api/offers/offers/${id}/grid`, { method: "PUT", body: JSON.stringify(body) }), offer!);
      setNotice(done);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the CV scoring");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const criteria = criteriaOf(rows);
    if (typeof criteria === "string") setError(criteria);
    else put({ criteria }, "Saved. Every CV of this offer is being scored again.");
  }

  function rebuild() {
    if (window.confirm("Build the CV scoring from the offer's skills again? Your changes are lost."))
      put({ rebuild: true }, "Built from the skills. Every CV of this offer is being scored again.");
  }

  return (
    <div className="max-w-4xl">
      <Link href={`/offers/${id}`} className="text-sm text-gray-500 hover:text-blue-600 mb-1 inline-block">
        ← {offer.title}
      </Link>
      <h1 className="text-2xl font-bold text-gray-800 mb-5">CV scoring</h1>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <CvGridEditor rows={rows} onChange={setRows} />
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {notice && <p className="text-green-700 text-sm mb-4">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={save}
          disabled={busy || JSON.stringify(rows) === saved}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={rebuild}
          disabled={busy}
          className="border border-gray-300 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition"
        >
          Build from the skills again
        </button>
      </div>
    </div>
  );
}
