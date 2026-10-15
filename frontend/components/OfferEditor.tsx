"use client";

// Create an offer, or change one: the form (title, description, budget,
// skills with priorities), then the generated test recipe to adjust.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  levelLabel,
  Offer,
  priorityLabel,
  Recipe,
  RecipeRow,
  Stock,
  topicGroup,
  topicName,
} from "@/lib/api";

const MAX_PER_ROW = 20;
const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);

type Warning = Recipe["warnings"][number];

export default function OfferEditor({ offerId: initialId }: { offerId?: string }) {
  const router = useRouter();

  // Form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(20);
  const [weightTheory, setWeightTheory] = useState(0.5);
  const [stock, setStock] = useState<Stock[] | null>(null);
  // language → priority (1-5); absent = not selected
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  // A competence the question bank does not have (e.g. Airflow, Power BI): only the CV shows it.
  const [newSkill, setNewSkill] = useState("");

  // Recipe
  const [step, setStep] = useState<"form" | "recipe">("form");
  const [offerId, setOfferId] = useState(initialId ?? "");
  const [status, setStatus] = useState<Offer["status"]>("draft");
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [savedRows, setSavedRows] = useState<RecipeRow[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const [loading, setLoading] = useState(Boolean(initialId));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<Stock[]>("/api/offers/stock")
      .then(setStock)
      .catch(() => setStock([]));
  }, []);

  // Editing an existing offer opens on its recipe.
  useEffect(() => {
    if (!initialId) return;
    Promise.all([api<Offer>(`/api/offers/offers/${initialId}`), api<Recipe>(`/api/offers/offers/${initialId}/recipe`)])
      .then(([o, r]) => {
        setTitle(o.title);
        setDescription(o.description);
        setBudget(o.question_budget);
        setWeightTheory(o.weight_theory);
        setStatus(o.status);
        setPriorities(Object.fromEntries(o.skills.map((s) => [s.language, s.priority])));
        setRows(o.recipe);
        setSavedRows(o.recipe);
        setWarnings(r.warnings);
        setStep("recipe");
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Offer not found"))
      .finally(() => setLoading(false));
  }, [initialId]);

  const stockFor = (language: string, level: number) =>
    stock?.find((s) => s.language === language && s.level === level) ?? { code: 0, qcm: 0 };
  const levelsFor = (language: string) =>
    (stock ?? [])
      .filter((s) => s.language === language)
      .map((s) => s.level)
      .sort();

  const byGroup = useMemo(() => {
    const groups: Record<string, string[]> = {};
    const bank = new Set((stock ?? []).map((s) => s.language));
    for (const language of [...bank].sort()) {
      (groups[topicGroup(language)] ??= []).push(language);
    }
    const others = Object.keys(priorities).filter((language) => !bank.has(language));
    if (others.length) groups["Other competences"] = others;
    return groups;
  }, [stock, priorities]);

  function addSkill() {
    const name = newSkill.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!/^[\p{L}\p{N}_+#.][\p{L}\p{N}_+#. /&'-]*$/u.test(name) || name.length > 40) {
      setError("A competence is up to 40 letters, digits, spaces and + # . / & ' -");
      return;
    }
    const same = [...Object.keys(priorities), ...(stock ?? []).map((s) => s.language)].find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    setError("");
    setPriorities((prev) => ({ ...prev, [same ?? name]: prev[same ?? name] ?? 4 }));
    setNewSkill("");
  }

  function toggleSkill(language: string) {
    setPriorities((prev) => {
      if (language in prev) {
        const next = { ...prev };
        delete next[language];
        return next;
      }
      return { ...prev, [language]: 1 };
    });
  }

  async function handleGenerate() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (Object.keys(priorities).length === 0) {
      setError("Select at least one skill");
      return;
    }
    setError("");
    setNotice("");
    setGenerating(true);
    try {
      const body = JSON.stringify({
        title,
        description,
        question_budget: budget,
        skills: Object.entries(priorities).map(([language, priority]) => ({ language, priority })),
      });
      const offer = offerId
        ? await api<Offer>(`/api/offers/offers/${offerId}`, { method: "PATCH", body })
        : await api<Offer>("/api/offers/offers", { method: "POST", body });
      setOfferId(offer.id);
      setStatus(offer.status);
      await api(`/api/offers/offers/${offer.id}/weights`, {
        method: "PATCH",
        body: JSON.stringify({ weight_theory: weightTheory, weight_practice: Math.round((1 - weightTheory) * 100) / 100 }),
      });
      const recipe = await api<Recipe>(`/api/offers/offers/${offer.id}/recipe/generate`, { method: "POST" });
      const generated = recipe.rows.map(({ language, level, code_count, qcm_count }) => ({ language, level, code_count, qcm_count }));
      setRows(generated);
      setSavedRows(generated);
      setWarnings(recipe.warnings);
      setStep("recipe");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to generate recipe");
    } finally {
      setGenerating(false);
    }
  }

  function updateRow(index: number, patch: Partial<RecipeRow>) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        // Keep the counts within what the new level has.
        const s = stockFor(next.language, next.level);
        return { ...next, code_count: Math.min(next.code_count, s.code), qcm_count: Math.min(next.qcm_count, s.qcm) };
      }),
    );
  }

  async function saveRecipe(): Promise<boolean> {
    const recipe = await api<Recipe>(`/api/offers/offers/${offerId}/recipe`, {
      method: "PUT",
      body: JSON.stringify({ rows }),
    });
    setSavedRows(rows);
    setWarnings(recipe.warnings);
    return true;
  }

  async function handleSaveChanges() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveRecipe();
      setNotice("Recipe saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setSaving(true);
    setError("");
    try {
      if (dirty) await saveRecipe();
      if (status === "draft") await api(`/api/offers/offers/${offerId}/publish`, { method: "POST" });
      router.push(`/offers/${offerId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not validate the offer");
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);
  const selectedCount = Object.keys(priorities).length;
  const testCount = Object.values(priorities).filter((p) => p <= 3).length;
  const cvOnlyCount = selectedCount - testCount;

  if (loading) return <p className="text-gray-500">Loading…</p>;

  // ── STEP: RECIPE ──────────────────────────────────────────────────────────
  if (step === "recipe") {
    const totalUsed = rows.reduce((s, r) => s + r.qcm_count + r.code_count, 0);
    const overBudget = totalUsed > budget;
    const selectCls =
      "border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white disabled:opacity-50";
    // Live warnings only make sense for the saved recipe.
    const shownWarnings = dirty ? warnings.filter((w) => w.code !== "budget_mismatch" && w.code !== "stock_low") : warnings;

    return (
      <div className="max-w-4xl">
        <div className="mb-6">
          <button onClick={() => setStep("form")} className="text-sm text-gray-500 hover:text-blue-600 mb-2 inline-block">
            ← Back to form
          </button>
          <h1 className="text-2xl font-bold text-gray-800">{initialId ? "Test Recipe" : "Generated Recipe"}</h1>
          <p className="text-gray-500 text-sm mt-1">{title}</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4 flex items-center gap-6">
          <div className="shrink-0">
            <p className="text-xs text-gray-500 mb-1">Questions used</p>
            <p className={`text-3xl font-bold tabular-nums ${overBudget ? "text-red-600" : "text-gray-900"}`}>
              {totalUsed}
              <span className="text-base font-normal text-gray-400"> / {budget}</span>
            </p>
          </div>
          <div className="flex-1">
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${overBudget ? "bg-red-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(100, (totalUsed / budget) * 100)}%` }}
              />
            </div>
            {overBudget && <p className="text-xs text-red-600 mt-1">Over budget — reduce some questions or raise the budget</p>}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-4">
          {rows.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">
              No recipe rows generated — check your skill priorities and the question bank.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left">Skill</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-center">Level</th>
                  <th className="px-4 py-3 text-center">QCM</th>
                  <th className="px-4 py-3 text-center">Code</th>
                  <th className="px-4 py-3 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => {
                  const s = stockFor(row.language, row.level);
                  const levels = levelsFor(row.language);
                  const priority = priorities[row.language];
                  return (
                    <tr key={row.language} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{topicName(row.language)}</td>
                      <td className="px-4 py-3">
                        {priority ? (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                              priority <= 3 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            P{priority} — {priorityLabel[priority]}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <select value={row.level} onChange={(e) => updateRow(i, { level: Number(e.target.value) })} className={selectCls}>
                          {!levels.includes(row.level) && <option value={row.level}>Level {row.level}</option>}
                          {levels.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              Level {lvl} · {levelLabel[lvl]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <select
                            value={row.qcm_count}
                            onChange={(e) => updateRow(i, { qcm_count: Number(e.target.value) })}
                            className={selectCls}
                            disabled={s.qcm === 0}
                          >
                            {range(Math.max(row.qcm_count, Math.min(MAX_PER_ROW, s.qcm))).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-400">{s.qcm} avail.</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <select
                            value={row.code_count}
                            onChange={(e) => updateRow(i, { code_count: Number(e.target.value) })}
                            className={selectCls}
                            disabled={s.code === 0}
                          >
                            {range(Math.max(row.code_count, Math.min(MAX_PER_ROW, s.code))).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-400">{s.code} avail.</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-800 tabular-nums">{row.qcm_count + row.code_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {shownWarnings.length > 0 && (
          <div className="space-y-2 mb-4">
            {shownWarnings.map((w, i) => (
              <div
                key={i}
                className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800 flex items-start gap-2"
              >
                <span className="mt-0.5">⚠️</span>
                <span>
                  {w.skill && <span className="font-semibold">{topicName(w.skill)}: </span>}
                  {w.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {notice && <p className="text-green-700 text-sm mb-4">{notice}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSaveChanges}
            disabled={saving || !dirty}
            className="border border-gray-300 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={handleValidate}
            disabled={saving || totalUsed === 0}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {status === "draft" ? "Validate offer →" : "Save and back to offer →"}
          </button>
        </div>
        {status === "draft" && (
          <p className="text-xs text-gray-400 mt-2">Validating publishes the offer: its apply link opens.</p>
        )}
      </div>
    );
  }

  // ── STEP: FORM ────────────────────────────────────────────────────────────
  const input = "w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">{offerId ? "Edit Job Offer" : "New Job Offer"}</h1>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Data Scientist" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Job description, shown on the apply page…"
            className={`${input} resize-y`}
          />
        </div>

        <div className="flex flex-wrap gap-8">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Question budget</label>
            <input
              type="number"
              min={1}
              max={100}
              value={budget}
              onChange={(e) => setBudget(parseInt(e.target.value) || 20)}
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Total number of questions in the test (default: 20)</p>
          </div>
          <div className="flex-1 min-w-56">
            <label className="block text-sm font-medium text-gray-700 mb-1">Score weights</label>
            <div className="flex items-center gap-3 text-sm text-gray-600 tabular-nums">
              <span className="w-20 whitespace-nowrap">QCM {Math.round(weightTheory * 100)}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(weightTheory * 100)}
                onChange={(e) => setWeightTheory(Number(e.target.value) / 100)}
                className="flex-1 accent-blue-600"
              />
              <span className="w-20 whitespace-nowrap text-right">Code {Math.round((1 - weightTheory) * 100)}%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">How much each part counts in the final score</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">Skills selection</label>
            {selectedCount > 0 && (
              <div className="flex gap-3 text-xs">
                <span className="text-green-700 font-medium">{testCount} in test</span>
                {cvOnlyCount > 0 && <span className="text-gray-500">{cvOnlyCount} CV only</span>}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {Object.entries(byGroup).map(([group, languages]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {languages.map((language) => {
                    const selected = language in priorities;
                    const priority = priorities[language];
                    const isTest = selected && priority <= 3;
                    const isCvOnly = selected && priority > 3;
                    return (
                      <div
                        key={language}
                        onClick={() => !selected && toggleSkill(language)}
                        className={`rounded-lg border px-3 py-2 transition-colors ${
                          isTest
                            ? "border-green-400 bg-green-50"
                            : isCvOnly
                              ? "border-gray-300 bg-gray-50"
                              : "border-gray-200 bg-white hover:border-blue-300 cursor-pointer"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSkill(language);
                            }}
                            className={`text-sm font-medium leading-none ${
                              isTest ? "text-green-800" : isCvOnly ? "text-gray-500" : "text-gray-700"
                            }`}
                          >
                            {topicName(language)}
                          </button>
                          {selected && (
                            <select
                              value={priority}
                              onChange={(e) => setPriorities({ ...priorities, [language]: Number(e.target.value) })}
                              onClick={(e) => e.stopPropagation()}
                              className={`text-xs border rounded px-1 py-0.5 focus:outline-none ${
                                isTest ? "border-green-300 bg-green-50 text-green-800" : "border-gray-300 bg-white text-gray-600"
                              }`}
                            >
                              {[1, 2, 3, 4, 5].map((p) => (
                                <option key={p} value={p}>
                                  P{p} — {priorityLabel[p]}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add a competence</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                  maxLength={40}
                  placeholder="e.g. Airflow, Power BI, Scrum"
                  className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={addSkill}
                  className="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Any competence the CV should show. Without questions in the bank it is not tested, only looked for in the CV.
              </p>
            </div>
            {stock === null && <p className="text-sm text-gray-400">Loading skills…</p>}
            {stock?.length === 0 && (
              <p className="text-sm text-gray-400">The question bank is empty. Add questions to Code Playground first.</p>
            )}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {generating ? "Generating…" : "Generate recipe →"}
          </button>
          <button
            type="button"
            onClick={() => (initialId ? setStep("recipe") : router.back())}
            className="text-gray-600 px-5 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
        </div>
        {offerId && <p className="text-xs text-gray-400">Generating again replaces the current recipe.</p>}
      </div>
    </div>
  );
}
