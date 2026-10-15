"use client";

// The offer's CV grid in detail: for each competence, the words that show it in
// a CV and the points it is worth. Saving scores every CV of the offer again.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, Criterion, formatPoints, Grid, Offer, priorityLabel, topicName } from "@/lib/api";
import { useUser } from "../../../AppShell";

// The id a grid accepts: lowercase letters, digits and _ . + # / -
function slug(label: string, used: Set<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_.+#/]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "criterion";
  let id = /^[a-z0-9]/.test(base) ? base : `c${base}`;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

type Row = Criterion & { termsText: string };

const toRows = (criteria: Criterion[]): Row[] => criteria.map((c) => ({ ...c, termsText: c.terms.join(", ") }));

export default function GridPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function show(grid: Grid) {
    const next = toRows(grid.criteria);
    setRows(next);
    setSaved(JSON.stringify(next));
    setVersion(grid.version);
  }

  useEffect(() => {
    Promise.all([api<Offer>(`/api/offers/offers/${id}`), api<Grid>(`/api/offers/offers/${id}/grid`)])
      .then(([o, g]) => {
        setOffer(o);
        show(g);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the grid"))
      .finally(() => setLoading(false));
  }, [id]);

  if (user?.role === "editor") return <p className="text-gray-500">Editors can read offers but not change them.</p>;
  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!offer) return <p className="text-red-600">{error}</p>;

  const dirty = JSON.stringify(rows) !== saved;
  const priorities = Object.fromEntries(offer.skills.map((s) => [s.language.toLowerCase(), s.priority]));

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setNotice("");
  }

  function add() {
    setRows((prev) => [
      ...prev,
      { id: "", label: "", terms: [], termsText: "", default_synonyms: true, points_present: 1, points_absent: 0 },
    ]);
    setNotice("");
  }

  async function save() {
    setError("");
    setNotice("");
    const used = new Set<string>();
    const criteria: Criterion[] = [];
    for (const r of rows) {
      const label = r.label.trim();
      if (!label) {
        setError("Every competence needs a name");
        return;
      }
      const id = r.id && !used.has(r.id) ? r.id : slug(label, used);
      used.add(id);
      const terms = [...new Set(r.termsText.split(",").map((t) => t.trim()).filter(Boolean))];
      criteria.push({
        id,
        label,
        terms,
        default_synonyms: r.default_synonyms,
        points_present: Math.max(0, Math.min(50, Number(r.points_present) || 0)),
        points_absent: Math.min(0, Math.max(-50, Number(r.points_absent) || 0)),
      });
    }
    setBusy(true);
    try {
      show(await api<Grid>(`/api/offers/offers/${id}/grid`, { method: "PUT", body: JSON.stringify({ criteria }) }));
      setNotice("Grid saved. Every CV of this offer is being scored again.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the grid");
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    if (!window.confirm("Build the grid from the offer's skills again? Your changes to the grid are lost.")) return;
    setBusy(true);
    setError("");
    try {
      show(await api<Grid>(`/api/offers/offers/${id}/grid`, { method: "PUT", body: JSON.stringify({ rebuild: true }) }));
      setNotice("Grid built from the skills. Every CV of this offer is being scored again.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not rebuild the grid");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  const number = "w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div>
      <Link href={`/offers/${id}`} className="text-sm text-gray-500 hover:text-blue-600 mb-1 inline-block">
        ← {offer.title}
      </Link>
      <h1 className="text-2xl font-bold text-gray-800">CV Grid</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">Version {version}</p>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 mb-5 text-sm text-gray-700 space-y-1">
        <p>
          A CV earns the points of each competence it shows, <strong>once</strong>, however often it mentions it. A missing
          competence costs its &quot;if missing&quot; points (core skills: −20 by default).
        </p>
        <p>
          Recruiters then add their own points on passages of the CV, from −100 to +100. A CV&apos;s points are the sum of
          both, with no limit.
        </p>
        <p className="text-gray-500">
          Built from the offer&apos;s skills: P1 core +1 / −20 if missing, P2 +0.5, P3 +0.1, P4 CV only +0.5, P5 bonus +0.1.
          Changing the skills later keeps the lines you edit here.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 text-left">Competence</th>
              <th className="px-3 py-3 text-left">Other words that count</th>
              <th className="px-3 py-3 text-center" title="Also look for known synonyms, e.g. JS for JavaScript">
                Synonyms
              </th>
              <th className="px-3 py-3 text-center">If found</th>
              <th className="px-3 py-3 text-center">If missing</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => {
              const priority = priorities[r.label.toLowerCase()];
              return (
                <tr key={i} className="align-top">
                  <td className="px-3 py-2 min-w-40">
                    <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} maxLength={80} placeholder="e.g. Airflow" className={input} />
                    <p className="text-xs text-gray-400 mt-1">
                      {priority ? `P${priority} — ${priorityLabel[priority]}` : r.id ? "Added to the grid" : "New"}
                      {r.label && topicName(r.label) !== r.label && ` · ${topicName(r.label)}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 min-w-56">
                    <input
                      value={r.termsText}
                      onChange={(e) => update(i, { termsText: e.target.value })}
                      placeholder="Comma separated, e.g. pandas, numpy"
                      className={input}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={r.default_synonyms}
                      onChange={(e) => update(i, { default_synonyms: e.target.checked })}
                      className="mt-2 accent-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={0.1}
                      value={r.points_present}
                      onChange={(e) => update(i, { points_present: e.target.value as unknown as number })}
                      className={number}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min={-50}
                      max={0}
                      step={1}
                      value={r.points_absent}
                      onChange={(e) => update(i, { points_absent: e.target.value as unknown as number })}
                      className={number}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      className="text-xs text-red-600 hover:underline mt-2"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No competence in the grid.</p>}
        <div className="px-3 py-3 border-t border-gray-100">
          <button type="button" onClick={add} className="text-sm text-blue-600 hover:underline">
            + Add a competence
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-4">
        A CV showing everything earns{" "}
        <strong className="tabular-nums">{formatPoints(rows.reduce((sum, r) => sum + (Number(r.points_present) || 0), 0))}</strong>{" "}
        from the grid.
      </p>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {notice && <p className="text-green-700 text-sm mb-4">{notice}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {busy ? "Saving…" : "Save the grid"}
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
