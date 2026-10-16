"use client";

// The CV scoring grid: one line per competence, its level, the words that show it
// in a CV and its points. Lines for the offer's skills follow them; recruiters add others.
import { Criterion, formatPoints, priorityLabel, skillLabel, topicName } from "@/lib/api";

// Points a line earns by level when the CV shows it, and costs when missing (as CV Analyzer builds them).
export const PRIORITY_POINTS: Record<number, [number, number]> = { 1: [1, -20], 2: [0.5, 0], 3: [0.1, 0], 4: [0.5, 0], 5: [0.1, 0] };
const ADDED_LEVEL = 2;

export type GridRow = {
  // The skill this line comes from (its language), or null for a competence added to the grid.
  skill: string | null;
  // Changed by hand: a skill's new priority no longer resets its level and points.
  touched: boolean;
  id: string;
  label: string;
  // 1 essential … 5 bonus.
  level: number;
  termsText: string;
  default_synonyms: boolean;
  points_present: number | string;
  points_absent: number | string;
};

export function skillRow(language: string, priority: number): GridRow {
  const [present, absent] = PRIORITY_POINTS[priority];
  return { skill: language, touched: false, id: "", label: skillLabel(language), level: priority, termsText: "", default_synonyms: true, points_present: present, points_absent: absent };
}

// Lines for the selected skills (best priority first), then the added competences.
// A skill's line keeps its edits; skills in `dropped` get no line.
export function syncRows(rows: GridRow[], priorities: Record<string, number>, dropped: Set<string>): GridRow[] {
  const skills = Object.entries(priorities)
    .filter(([language]) => !dropped.has(language))
    .sort((a, b) => a[1] - b[1]);
  const fromSkills = skills.map(([language, priority]) => {
    const row = rows.find((r) => r.skill === language);
    if (!row) return skillRow(language, priority);
    if (row.touched) return row;
    return { ...skillRow(language, priority), id: row.id };
  });
  return [...fromSkills, ...rows.filter((r) => r.skill === null)];
}

// The level of a line saved without one: its skill's priority, else the first level with its points.
function levelOf(c: Criterion, priority: number | undefined): number {
  if (c.level) return c.level;
  if (priority) return priority;
  const match = Object.entries(PRIORITY_POINTS).find(([, [p, a]]) => p === c.points_present && a === c.points_absent);
  return match ? Number(match[0]) : ADDED_LEVEL;
}

// Lines of a saved grid, linked back to the offer's skills.
export function rowsFrom(criteria: Criterion[], priorities: Record<string, number>): GridRow[] {
  return criteria.map((c) => {
    const skill =
      Object.keys(priorities).find((language) =>
        [language, skillLabel(language)].some((name) => name.toLowerCase() === c.label.toLowerCase()),
      ) ?? null;
    const priority = skill ? priorities[skill] : undefined;
    const level = levelOf(c, priority);
    const [present, absent] = priority ? PRIORITY_POINTS[priority] : [NaN, NaN];
    return {
      skill,
      touched:
        !skill || level !== priority || c.terms.length > 0 || !c.default_synonyms || c.points_present !== present || c.points_absent !== absent,
      id: c.id,
      label: c.label,
      level,
      termsText: c.terms.join(", "),
      default_synonyms: c.default_synonyms,
      points_present: c.points_present,
      points_absent: c.points_absent,
    };
  });
}

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
  const start = /^[a-z0-9]/.test(base) ? base : `c${base}`;
  let id = start;
  for (let i = 2; used.has(id); i++) id = `${start}-${i}`;
  return id;
}

// The grid to save, or an error message.
export function criteriaOf(rows: GridRow[]): Criterion[] | string {
  const used = new Set<string>();
  const out: Criterion[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) return "Every competence of the CV scoring needs a name";
    const id = r.id && !used.has(r.id) ? r.id : slug(label, used);
    used.add(id);
    out.push({
      id,
      label,
      level: r.level,
      terms: [...new Set(r.termsText.split(",").map((t) => t.trim()).filter(Boolean))],
      default_synonyms: r.default_synonyms,
      points_present: Math.max(0, Math.min(50, Number(r.points_present) || 0)),
      // A cost typed without its minus sign is still a cost.
      points_absent: Math.max(-50, -Math.abs(Number(r.points_absent) || 0)),
    });
  }
  return out;
}

export default function CvGridEditor({ rows, onChange, onRemove }: {
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  // Called before a skill's line goes, so the skill does not bring it back.
  onRemove?: (row: GridRow) => void;
}) {
  const update = (index: number, patch: Partial<GridRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch, touched: true } : r)));
  const setLevel = (index: number, level: number) => {
    const [present, absent] = PRIORITY_POINTS[level];
    update(index, { level, points_present: present, points_absent: absent });
  };
  const input = "w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  const number = "w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums bg-white focus:outline-none focus:ring-2";
  const total = rows.reduce((sum, r) => sum + (Number(r.points_present) || 0), 0);

  return (
    <div>
      <div className="border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Competence</th>
              <th className="px-3 py-2 text-left">Level</th>
              <th className="px-3 py-2 text-center">If found</th>
              <th className="px-3 py-2 text-center">If missing</th>
              <th className="px-3 py-2 text-left">Other words that count</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={r.skill ? `skill:${r.skill}` : `row:${i}`} className="align-top">
                <td className="px-3 py-2 min-w-40">
                  {r.skill ? (
                    <p className="py-1.5 font-medium text-gray-900">{topicName(r.skill)}</p>
                  ) : (
                    <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} maxLength={80} placeholder="e.g. Airflow" className={input} />
                  )}
                  <p className="text-xs text-gray-400">{r.skill ? "From the skills" : "Added for the CV"}</p>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={r.level}
                    onChange={(e) => setLevel(i, Number(e.target.value))}
                    aria-label="Level"
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {[1, 2, 3, 4, 5].map((level) => (
                      <option key={level} value={level}>
                        P{level} — {priorityLabel[level]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.1}
                    value={r.points_present}
                    onChange={(e) => update(i, { points_present: e.target.value })}
                    aria-label="Points if found"
                    className={`${number} focus:ring-blue-500`}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min={-50}
                    max={0}
                    step={1}
                    value={r.points_absent}
                    onChange={(e) => update(i, { points_absent: e.target.value })}
                    aria-label="Points if missing"
                    className={`${number} focus:ring-red-500 ${Number(r.points_absent) ? "text-red-700" : ""}`}
                  />
                </td>
                <td className="px-3 py-2 min-w-52">
                  <input
                    value={r.termsText}
                    onChange={(e) => update(i, { termsText: e.target.value })}
                    placeholder="Comma separated, e.g. pandas, numpy"
                    className={input}
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={r.default_synonyms}
                      onChange={(e) => update(i, { default_synonyms: e.target.checked })}
                      className="accent-blue-600"
                    />
                    Known synonyms too (JS for JavaScript…)
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      onRemove?.(r);
                      onChange(rows.filter((_, j) => j !== i));
                    }}
                    className="text-xs text-red-600 hover:underline mt-2"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Select skills above, or add a competence.</p>}
        <div className="px-3 py-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              const [present, absent] = PRIORITY_POINTS[ADDED_LEVEL];
              onChange([
                ...rows,
                { skill: null, touched: true, id: "", label: "", level: ADDED_LEVEL, termsText: "", default_synonyms: true, points_present: present, points_absent: absent },
              ]);
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            + Add a competence
          </button>
          <span className="text-xs text-gray-500">
            A CV showing everything earns <strong className="tabular-nums">{formatPoints(total)}</strong>
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        A level sets the points: Essential +1 (−20 when missing), Important and CV only +0.5, Secondary and Bonus +0.1. Change them as you like.
        Each competence found counts once, however often the CV mentions it. Recruiters then add their own points on passages of the CV, from −100 to +100.
      </p>
    </div>
  );
}
