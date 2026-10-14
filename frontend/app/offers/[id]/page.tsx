"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError, levelLabel, Offer, Recipe, RecipeRow, statusLabel, Stock } from "@/lib/api";
import { useUser } from "../../AppShell";

const MAX_PER_ROW = 20;
const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);

export default function OfferPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const canWrite = user?.role !== "editor";
  const [offer, setOffer] = useState<Offer | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [savedRows, setSavedRows] = useState<RecipeRow[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = async <T,>(action: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (done) setNotice(done);
      return result;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  };

  useEffect(() => {
    run(async () => {
      const [o, r, s] = await Promise.all([
        api<Offer>(`/api/offers/offers/${id}`),
        api<Recipe>(`/api/offers/offers/${id}/recipe`),
        api<Stock[]>("/api/offers/stock"),
      ]);
      setOffer(o);
      setRecipe(r);
      setRows(o.recipe);
      setSavedRows(o.recipe);
      setStock(s);
    });
  }, [id]);

  const stockFor = (language: string, level: number) =>
    stock.find((s) => s.language === language && s.level === level) ?? { code: 0, qcm: 0 };
  const languages = useMemo(() => [...new Set(stock.map((s) => s.language))].sort(), [stock]);
  const levelsFor = (language: string) => stock.filter((s) => s.language === language).map((s) => s.level).sort();
  const total = rows.reduce((n, r) => n + r.code_count + r.qcm_count, 0);

  function setRow(i: number, patch: Partial<RecipeRow>) {
    setRows(rows.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      // Keep counts within what the new language and level have.
      const s = stockFor(next.language, next.level);
      return { ...next, code_count: Math.min(next.code_count, s.code), qcm_count: Math.min(next.qcm_count, s.qcm) };
    }));
  }

  function addRow() {
    const taken = new Set(rows.map((r) => `${r.language}:${r.level}`));
    const free = stock.find((s) => !taken.has(`${s.language}:${s.level}`));
    if (free) setRows([...rows, { language: free.language, level: free.level, code_count: 0, qcm_count: 0 }]);
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    if (!offer) return;
    const { title, description, question_budget, cv_score_threshold } = offer;
    const saved = await run(
      () => api<Offer>(`/api/offers/offers/${id}`, { method: "PATCH", body: JSON.stringify({ title, description, question_budget, cv_score_threshold }) }),
      "Details saved.",
    );
    if (saved) {
      setOffer(saved);
      setRecipe(await api<Recipe>(`/api/offers/offers/${id}/recipe`));
    }
  }

  async function saveWeights(theory: number) {
    const saved = await run(() =>
      api<Offer>(`/api/offers/offers/${id}/weights`, {
        method: "PATCH",
        body: JSON.stringify({ weight_theory: theory, weight_practice: Math.round((1 - theory) * 100) / 100 }),
      }),
    );
    if (saved) setOffer(saved);
  }

  async function saveRecipe() {
    const saved = await run(
      () => api<Recipe>(`/api/offers/offers/${id}/recipe`, { method: "PUT", body: JSON.stringify({ rows }) }),
      "Test saved.",
    );
    if (saved) {
      setRecipe(saved);
      setSavedRows(rows);
    }
  }

  async function setStatus(action: "publish" | "archive" | "restore") {
    const saved = await run(() => api<Offer>(`/api/offers/offers/${id}/${action}`, { method: "POST" }));
    if (saved) setOffer(saved);
  }

  if (!offer) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const applyLink = typeof window !== "undefined" ? `${window.location.origin}/apply/${offer.public_token}` : "";
  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);

  return (
    <>
      <div className="title-row">
        <h1>{offer.title}</h1>
        <span className={`status status-${offer.status}`}>{statusLabel[offer.status]}</span>
        <span className="spacer" />
        {canWrite && offer.status === "draft" && <button onClick={() => setStatus("publish")} disabled={dirty}>Publish</button>}
        {canWrite && offer.status === "active" && <button className="secondary" onClick={() => setStatus("archive")}>Archive</button>}
        {canWrite && offer.status === "archived" && <button className="secondary" onClick={() => setStatus("restore")}>Restore</button>}
      </div>
      {offer.status === "active" && (
        <p className="muted">
          Apply link: <code className="select">{applyLink}</code>
        </p>
      )}
      {offer.status !== "draft" && (
        <p>
          <a href={`/candidates?offer=${offer.id}`}>See the candidates</a>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <section className="card stack">
        <div className="section-head">
          <h2>Test</h2>
          <span className={total === offer.question_budget ? "muted num" : "warn num"}>
            {total} of {offer.question_budget} questions
          </span>
        </div>
        <p className="muted">For each language or topic and level, choose how many code and QCM questions. Every candidate gets their own random pick.</p>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="recipe">
              <thead>
                <tr>
                  <th>Language or topic</th>
                  <th>Level</th>
                  <th>Code</th>
                  <th>QCM</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = stockFor(r.language, r.level);
                  const levels = levelsFor(r.language);
                  const warning = recipe?.warnings.find((w) => w.row === i && w.code === "stock_low");
                  return (
                    <tr key={i}>
                      <td>
                        <select disabled={!canWrite} value={r.language} onChange={(e) => setRow(i, { language: e.target.value, level: levelsFor(e.target.value)[0] ?? 1 })}>
                          {!languages.includes(r.language) && <option value={r.language}>{r.language}</option>}
                          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                        {warning && !dirty && <div className="error small">{warning.message}</div>}
                      </td>
                      <td>
                        <select disabled={!canWrite} value={r.level} onChange={(e) => setRow(i, { level: Number(e.target.value) })}>
                          {!levels.includes(r.level) && <option value={r.level}>{r.level} · {levelLabel[r.level]}</option>}
                          {levels.map((l) => <option key={l} value={l}>{l} · {levelLabel[l]}</option>)}
                        </select>
                      </td>
                      <td>
                        <select disabled={!canWrite || s.code === 0} value={r.code_count} onChange={(e) => setRow(i, { code_count: Number(e.target.value) })}>
                          {range(Math.max(r.code_count, Math.min(MAX_PER_ROW, s.code))).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="muted small"> of {s.code}</span>
                      </td>
                      <td>
                        <select disabled={!canWrite || s.qcm === 0} value={r.qcm_count} onChange={(e) => setRow(i, { qcm_count: Number(e.target.value) })}>
                          {range(Math.max(r.qcm_count, Math.min(MAX_PER_ROW, s.qcm))).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="muted small"> of {s.qcm}</span>
                      </td>
                      <td>
                        {canWrite && <button className="link" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {stock.length === 0 && <p className="muted">The question bank is empty. Add questions to Code Playground first.</p>}
        {canWrite && (
          <div className="row">
            <button className="secondary" onClick={addRow} disabled={rows.length >= stock.length}>Add a row</button>
            <button onClick={saveRecipe} disabled={!dirty}>Save test</button>
          </div>
        )}
      </section>

      <form className="card stack" onSubmit={saveDetails}>
        <h2>Details</h2>
        <label>
          Title
          <input disabled={!canWrite} value={offer.title} required onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
        </label>
        <label>
          Description, shown on the apply page
          <textarea disabled={!canWrite} rows={6} value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} />
        </label>
        <div className="row">
          <label>
            Questions in the test
            <input disabled={!canWrite} type="number" min={1} max={100} value={offer.question_budget} onChange={(e) => setOffer({ ...offer, question_budget: Number(e.target.value) })} />
          </label>
          <label>
            CV score needed for a test (0–100)
            <input disabled={!canWrite} type="number" min={0} max={100} value={offer.cv_score_threshold} onChange={(e) => setOffer({ ...offer, cv_score_threshold: Number(e.target.value) })} />
          </label>
        </div>
        {canWrite && <div><button type="submit">Save details</button></div>}
      </form>

      <section className="card stack">
        <h2>Scoring</h2>
        <p className="muted">How much each part counts in the final score.</p>
        <label className="weights">
          <span className="num">QCM {Math.round(offer.weight_theory * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={!canWrite}
            value={Math.round(offer.weight_theory * 100)}
            onChange={(e) => setOffer({ ...offer, weight_theory: Number(e.target.value) / 100, weight_practice: 1 - Number(e.target.value) / 100 })}
            onMouseUp={(e) => saveWeights(Number((e.target as HTMLInputElement).value) / 100)}
            onTouchEnd={(e) => saveWeights(Number((e.target as HTMLInputElement).value) / 100)}
            onKeyUp={(e) => saveWeights(Number((e.target as HTMLInputElement).value) / 100)}
          />
          <span className="num">Code {Math.round((1 - offer.weight_theory) * 100)}%</span>
        </label>
      </section>
    </>
  );
}
