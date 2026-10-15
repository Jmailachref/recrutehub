"use client";

// Create an offer, or change one, on one page in three parts:
//   1. the job: what candidates see, and the skills it asks for
//   2. the test: which questions candidates get, built from the skills
//   3. the CV scoring: how each CV earns points, filled in from the skills
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  Grid,
  levelLabel,
  Offer,
  priorityLabel,
  Recipe,
  RecipeRow,
  Stock,
  topicGroup,
  topicName,
} from "@/lib/api";
import CvGridEditor, { criteriaOf, GridRow, rowsFrom, syncRows } from "./CvGridEditor";

const MAX_PER_ROW = 20;
const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);

type Warning = Recipe["warnings"][number];

// The tested skills (P1-P3) a test was built from, to notice when they change.
const testedKey = (priorities: Record<string, number>) =>
  JSON.stringify(
    Object.entries(priorities)
      .filter(([, p]) => p <= 3)
      .sort(),
  );

function Section({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</span>
        <div>
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
        </div>
      </div>
      <div className="p-6 space-y-6">{children}</div>
    </section>
  );
}

export default function OfferEditor({ offerId: initialId }: { offerId?: string }) {
  const router = useRouter();

  // 1. The job
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stock, setStock] = useState<Stock[] | null>(null);
  // language → priority (1-5); absent = not selected
  const [priorities, setPriorities] = useState<Record<string, number>>({});

  // 2. The test
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [savedRows, setSavedRows] = useState<RecipeRow[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [builtFor, setBuiltFor] = useState("");

  // 3. The CV scoring: a line per selected skill (mandatory for P1), plus competences added for the CV.
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  // Skills whose line the recruiter removed from the CV scoring.
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const [offerId, setOfferId] = useState(initialId ?? "");
  const [status, setStatus] = useState<Offer["status"]>("draft");
  const [loading, setLoading] = useState(Boolean(initialId));
  const [busy, setBusy] = useState<"build" | "save" | "publish" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Stock[]>("/api/offers/stock")
      .then(setStock)
      .catch(() => setStock([]));
  }, []);

  useEffect(() => {
    if (!initialId) return;
    Promise.all([
      api<Offer>(`/api/offers/offers/${initialId}`),
      api<Recipe>(`/api/offers/offers/${initialId}/recipe`),
      api<Grid>(`/api/offers/offers/${initialId}/grid`).catch(() => null),
    ])
      .then(([o, r, grid]) => {
        setTitle(o.title);
        setDescription(o.description);
        setStatus(o.status);
        const loaded = Object.fromEntries(o.skills.map((s) => [s.language, s.priority]));
        setPriorities(loaded);
        setRows(o.recipe);
        setSavedRows(o.recipe);
        setWarnings(r.warnings);
        setBuiltFor(testedKey(loaded));
        if (grid) {
          const lines = rowsFrom(grid.criteria, loaded);
          setGridRows(lines);
          setDropped(new Set(Object.keys(loaded).filter((language) => !lines.some((l) => l.skill === language))));
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Offer not found"))
      .finally(() => setLoading(false));
  }, [initialId]);

  // The CV scoring follows the skills: a line appears, goes, or takes the new priority's points.
  useEffect(() => {
    setGridRows((prev) => syncRows(prev, priorities, dropped));
  }, [priorities, dropped]);

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

  function toggleSkill(language: string) {
    setDropped((prev) => {
      if (!prev.has(language)) return prev;
      const next = new Set(prev);
      next.delete(language);
      return next;
    });
    setPriorities((prev) => {
      if (language in prev) {
        const next = { ...prev };
        delete next[language];
        return next;
      }
      return { ...prev, [language]: 1 };
    });
  }

  // Saves the job and its CV scoring; creates the offer (a draft) the first time.
  async function saveOffer(): Promise<Offer | null> {
    if (!title.trim()) {
      setError("The job needs a title");
      return null;
    }
    if (Object.keys(priorities).length === 0) {
      setError("Select at least one skill");
      return null;
    }
    const criteria = criteriaOf(gridRows);
    if (typeof criteria === "string") {
      setError(criteria);
      return null;
    }
    const body = JSON.stringify({
      title,
      description,
      skills: Object.entries(priorities).map(([language, priority]) => ({ language, priority })),
    });
    const offer = offerId
      ? await api<Offer>(`/api/offers/offers/${offerId}`, { method: "PATCH", body })
      : await api<Offer>("/api/offers/offers", { method: "POST", body });
    setOfferId(offer.id);
    setStatus(offer.status);
    const grid = await api<Grid>(`/api/offers/offers/${offer.id}/grid`, { method: "PUT", body: JSON.stringify({ criteria }) });
    setGridRows(rowsFrom(grid.criteria, priorities));
    return offer;
  }

  async function buildTest() {
    setError("");
    setBusy("build");
    try {
      const offer = await saveOffer();
      if (!offer) return;
      const recipe = await api<Recipe>(`/api/offers/offers/${offer.id}/recipe/generate`, { method: "POST" });
      const generated = recipe.rows.map(({ language, level, code_count, qcm_count }) => ({ language, level, code_count, qcm_count }));
      setRows(generated);
      setSavedRows(generated);
      setWarnings(recipe.warnings);
      setBuiltFor(testedKey(priorities));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not build the test");
    } finally {
      setBusy(null);
    }
  }

  async function save(publish: boolean) {
    setError("");
    if (publish && rows.length === 0) {
      setError("Build the test first: candidates take it once they apply.");
      return;
    }
    setBusy(publish ? "publish" : "save");
    try {
      const offer = await saveOffer();
      if (!offer) return;
      if (dirty) {
        const recipe = await api<Recipe>(`/api/offers/offers/${offer.id}/recipe`, { method: "PUT", body: JSON.stringify({ rows }) });
        setSavedRows(rows);
        setWarnings(recipe.warnings);
      }
      if (publish && offer.status === "draft") await api(`/api/offers/offers/${offer.id}/publish`, { method: "POST" });
      router.push(`/offers/${offer.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the offer");
    } finally {
      setBusy(null);
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

  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);
  const selectedCount = Object.keys(priorities).length;
  const testCount = Object.values(priorities).filter((p) => p <= 3).length;
  const cvOnlyCount = selectedCount - testCount;
  const totalUsed = rows.reduce((s, r) => s + r.qcm_count + r.code_count, 0);
  const stale = rows.length > 0 && builtFor !== testedKey(priorities);
  // Live warnings only make sense for the saved test; the question budget is not shown here.
  const shownWarnings = warnings.filter((w) => w.code !== "budget_mismatch" && w.code !== "empty" && !(dirty && w.code === "stock_low"));

  if (loading) return <p className="text-gray-500">Loading…</p>;

  const input = "w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  const selectCls =
    "border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white disabled:opacity-50";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">{initialId ? "Edit Job Offer" : "New Job Offer"}</h1>

      <Section n={1} title="The job" hint="Candidates see the title and the description on the apply page. The skills set up the test and the CV scoring below.">
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

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">Skills</label>
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
            {stock === null && <p className="text-sm text-gray-400">Loading skills…</p>}
            {stock?.length === 0 && (
              <p className="text-sm text-gray-400">The question bank is empty. Add questions to Code Playground first.</p>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            P1 core, P2 important and P3 secondary skills are tested; P4 CV only and P5 bonus are only looked for in the CV.
          </p>
        </div>
      </Section>

      <Section n={2} title="The test" hint="What candidates are tested on once they apply: questions per skill and level, drawn from the question bank.">
        {rows.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 mb-3">
              {testCount === 0 ? "Select a P1, P2 or P3 skill above to test candidates on it." : `Built from the ${testCount} tested skill${testCount > 1 ? "s" : ""} above.`}
            </p>
            <button
              type="button"
              onClick={buildTest}
              disabled={busy !== null || testCount === 0}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {busy === "build" ? "Building…" : "Build the test from the skills"}
            </button>
          </div>
        ) : (
          <div>
            <div className="border border-gray-200 rounded-xl overflow-x-auto">
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
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-gray-600">
                <strong className="tabular-nums">{totalUsed}</strong> questions in the test
              </span>
              <button type="button" onClick={buildTest} disabled={busy !== null} className="text-blue-600 hover:underline disabled:opacity-50">
                {busy === "build" ? "Building…" : "Build again from the skills"}
              </button>
            </div>
            {stale && (
              <p className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">
                The tested skills changed since this test was built: build it again to follow them.
              </p>
            )}
            {shownWarnings.length > 0 && (
              <div className="space-y-2 mt-3">
                {shownWarnings.map((w, i) => (
                  <div key={i} className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">
                    {w.skill && <span className="font-semibold">{topicName(w.skill)}: </span>}
                    {w.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        n={3}
        title="CV scoring"
        hint="How each CV earns points. Every skill above gets a line at its level, from Essential to Bonus; change the level, the points and the words that count, remove lines or add other competences."
      >
        <CvGridEditor
          rows={gridRows}
          onChange={setGridRows}
          onRemove={(row) => row.skill && setDropped((prev) => new Set(prev).add(row.skill!))}
        />
      </Section>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {status === "draft" ? (
          <>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy !== null}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {busy === "publish" ? "Publishing…" : "Publish the offer"}
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              disabled={busy !== null}
              className="border border-gray-300 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition"
            >
              {busy === "save" ? "Saving…" : "Save as draft"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => save(false)}
            disabled={busy !== null}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
        )}
        <button
          type="button"
          onClick={() => (offerId ? router.push(`/offers/${offerId}`) : router.back())}
          className="text-gray-600 px-5 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition"
        >
          Cancel
        </button>
      </div>
      {status === "draft" && <p className="text-xs text-gray-400 mt-2">Publishing opens the offer&apos;s apply link.</p>}
    </div>
  );
}
