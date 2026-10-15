"use client";

// The CV scoring grid: one line per competence, the words that show it in a CV
// and its points. Lines for the offer's skills follow them; recruiters add others.
import { Criterion, formatPoints, priorityLabel, topicName } from "@/lib/api";

// Points a skill earns by priority when the CV shows it, and costs when missing (as CV Analyzer builds them).
export const PRIORITY_POINTS: Record<number, [number, number]> = { 1: [1, -20], 2: [0.5, 0], 3: [0.1, 0], 4: [0.5, 0], 5: [0.1, 0] };
export const MANDATORY_MISSING = -20;

export type GridRow = {
  // The skill this line comes from (its language), or null for a competence added to the grid.
  skill: string | null;
  // Changed by hand: a skill's new priority no longer resets its points.
  touched: boolean;
  id: string;
  label: string;
  termsText: string;
  default_synonyms: boolean;
  points_present: number | string;
  points_absent: number;
};

export function skillRow(language: string, priority: number): GridRow {
  const [present, absent] = PRIORITY_POINTS[priority];
  return { skill: language, touched: false, id: "", label: language, termsText: "", default_synonyms: true, points_present: present, points_absent: absent };
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
    const [present, absent] = PRIORITY_POINTS[priority];
    return { ...row, points_present: present, points_absent: absent };
  });
  return [...fromSkills, ...rows.filter((r) => r.skill === null)];
}

// Lines of a saved grid, linked back to the offer's skills.
export function rowsFrom(criteria: Criterion[], priorities: Record<string, number>): GridRow[] {
  return criteria.map((c) => {
    const skill = Object.keys(priorities).find((language) => language.toLowerCase() === c.label.toLowerCase()) ?? null;
    const [present, absent] = skill ? PRIORITY_POINTS[priorities[skill]] : [NaN, NaN];
    return {
      skill,
      touched: !skill || c.terms.length > 0 || !c.default_synonyms || c.points_present !== present || c.points_absent !== absent,
      id: c.id,
      label: c.label,
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
      terms: [...new Set(r.termsText.split(",").map((t) => t.trim()).filter(Boolean))],
      default_synonyms: r.default_synonyms,
      points_present: Math.max(0, Math.min(50, Number(r.points_present) || 0)),
      points_absent: Math.min(0, Math.max(-50, Number(r.points_absent) || 0)),
    });
  }
  return out;
}

export default function CvGridEditor({ rows, priorities, onChange, onRemove }: {
  rows: GridRow[];
  priorities: Record<string, number>;
  onChange: (rows: GridRow[]) => void;
  // Called before a skill's line goes, so the skill does not bring it back.
  onRemove?: (row: GridRow) => void;
}) {
  const update = (index: number, patch: Partial<GridRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch, touched: true } : r)));
  const input = "w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  const total = rows.reduce((sum, r) => sum + (Number(r.points_present) || 0), 0);

  return (
    <div>
      <div className="border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Competence</th>
              <th className="px-3 py-2 text-center" title="Missing from the CV costs 20 points">
                Mandatory
              </th>
              <th className="px-3 py-2 text-center">Points if found</th>
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
                  <p className="text-xs text-gray-400">
                    {r.skill ? `Skill · P${priorities[r.skill]} — ${priorityLabel[priorities[r.skill]]}` : "Added for the CV"}
                  </p>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={r.points_absent < 0}
                    onChange={(e) => update(i, { points_absent: e.target.checked ? MANDATORY_MISSING : 0 })}
                    className="mt-2.5 size-4 accent-red-600"
                    title={r.points_absent < 0 ? `Missing costs ${-r.points_absent} points` : "Missing costs nothing"}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.1}
                    value={r.points_present}
                    onChange={(e) => update(i, { points_present: e.target.value })}
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            onClick={() =>
              onChange([
                ...rows,
                { skill: null, touched: true, id: "", label: "", termsText: "", default_synonyms: true, points_present: 1, points_absent: 0 },
              ])
            }
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
        Each competence found counts once, however often the CV mentions it; a mandatory one costs 20 points when missing.
        Recruiters then add their own points on passages of the CV, from −100 to +100.
      </p>
    </div>
  );
}
