"use client";

// A candidate's CV as recruiters score it: the PDF with the passages they gave
// points to, the offer's competences found or missing, and the total in points.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  Box,
  CriterionResult,
  CvHighlight,
  CvLine,
  CvReview as Review,
  cvStatusLabel,
  formatPoints,
  HighlightIn,
  topicName,
} from "@/lib/api";
import type { Selection } from "./PdfViewer";
import ScorePopover from "./ScorePopover";

const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <p className="py-12 text-center text-sm text-gray-400">Opening the CV…</p>,
});

type Pending = { quote: string; anchor: { x: number; y: number }; target: Omit<HighlightIn, "points" | "comment"> };

const SECTIONS: Record<string, string> = {
  header: "Header",
  summary: "Profile",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  languages: "Languages",
  certifications: "Certifications",
  interests: "Interests",
};

const card = "bg-white rounded-xl border border-gray-200 shadow-sm";

export default function CvReview({ candidateId, canScore, onPoints }: {
  candidateId: string;
  canScore: boolean;
  // Called with the new total after points change, so the page header follows.
  onPoints?: (total: number | null) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"pdf" | "text" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [focusLines, setFocusLines] = useState<number[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api<Review>(`/api/candidates/candidates/${candidateId}/cv-review`);
      setReview(r);
      setError("");
      onPoints?.(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the CV review");
    }
  }, [candidateId, onPoints]);

  useEffect(() => {
    load();
  }, [load]);

  // Until the CV is read and scored, check again every two seconds.
  const waiting = review && (review.status === "queued" || review.status === "processing" || (review.status === "ready" && review.auto === null));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const lineBoxes = useCallback(
    (numbers: number[]): Box[] =>
      (review?.lines ?? [])
        .filter((ln) => numbers.includes(ln.n) && ln.bbox)
        .map((ln) => ({ page: ln.page, x0: ln.bbox![0], top: ln.bbox![1], x1: ln.bbox![2], bottom: ln.bbox![3] })),
    [review],
  );

  async function addHighlight(points: number, comment: string) {
    if (!pending) return;
    await api(`/api/candidates/candidates/${candidateId}/cv-highlights`, {
      method: "POST",
      body: JSON.stringify({ ...pending.target, points, comment: comment || null }),
    });
    setPending(null);
    window.getSelection()?.removeAllRanges();
    await load();
  }

  async function removeHighlight(h: CvHighlight) {
    try {
      await api(`/api/candidates/candidates/${candidateId}/cv-highlights/${h.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the points");
    }
  }

  if (error && !review) return <p className={`${card} p-6 text-sm text-red-600`}>{error}</p>;
  if (!review) return <p className={`${card} p-6 text-sm text-gray-400`}>Loading the CV…</p>;

  // A scanned CV has no text to select in the PDF: score it from the text OCR read.
  const shown = view ?? (review.ocr_used ? "text" : "pdf");
  const ready = review.status === "ready";
  const marks = review.highlights.map((h) => ({ id: h.id, boxes: h.boxes, points: h.points, active: h.id === active }));
  const pick = canScore && ready;

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold text-gray-800">CV</h2>
        <div className="flex items-center gap-3">
          <a
            href={`/api/candidates/candidates/${candidateId}/cv`}
            target="_blank"
            rel="noopener"
            className="text-sm text-blue-600 hover:underline"
          >
            Open the PDF
          </a>
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-sm">
            {(["pdf", "text"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 ${shown === v ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                {v === "pdf" ? "PDF" : "Text read"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {review.status === "failed" && <p className="mb-3 text-sm text-red-600">The CV could not be read: {review.error}</p>}
      {review.status === "unreadable" && <p className="mb-3 text-sm text-red-600">This CV has no readable text, even with OCR.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 rounded-xl bg-gray-200/60 p-3">
          <p className="mb-3 text-center text-xs text-gray-600">
            {!ready
              ? cvStatusLabel[review.status]
              : !canScore
                ? "Recruiters give points to passages of the CV."
                : shown === "pdf"
                  ? "Select a passage of the CV to give it points."
                  : "Click a line to give it points."}
          </p>
          {shown === "pdf" ? (
            <PdfViewer
              url={`/api/candidates/candidates/${candidateId}/cv`}
              marks={marks}
              focus={lineBoxes(focusLines)}
              onSelect={(s: Selection) =>
                pick && setPending({ quote: s.quote, anchor: s.anchor, target: { quote: s.quote, page: s.page, boxes: s.boxes } })
              }
              onMarkClick={(hid) => {
                setActive(hid);
                document.getElementById(`hl-${hid}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
            />
          ) : (
            <TextView
              lines={review.lines}
              highlights={review.highlights}
              focusLines={focusLines}
              onPick={(line, anchor) => pick && setPending({ quote: line.text, anchor, target: { line: line.n } })}
            />
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <PointsCard review={review} waiting={!!waiting} />
          <CriteriaCard criteria={review.criteria} onHover={(c) => setFocusLines(c ? c.lines : [])} />
          <div className={card}>
            <h3 className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">
              Scored passages ({review.highlights.length})
            </h3>
            <div className="p-4">
              {review.highlights.length === 0 ? (
                <p className="text-center text-sm text-gray-400">No passage scored yet.</p>
              ) : (
                <ul className="space-y-2">
                  {review.highlights.map((h) => (
                    <li
                      id={`hl-${h.id}`}
                      key={h.id}
                      onMouseEnter={() => setActive(h.id)}
                      onMouseLeave={() => setActive(null)}
                      className={`rounded-lg border p-2.5 text-sm transition ${h.id === active ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-3 text-gray-700 italic">“{h.quote}”</p>
                        <PointsBadge value={h.points} />
                      </div>
                      {h.comment && <p className="mt-1.5 text-gray-900">{h.comment}</p>}
                      <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500">
                        <span>
                          {h.mine ? "You" : h.author_name} · {new Date(h.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        {canScore && (
                          <button onClick={() => removeHighlight(h)} className="text-red-600 hover:underline">
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      {pending && <ScorePopover quote={pending.quote} anchor={pending.anchor} onSubmit={addHighlight} onClose={() => setPending(null)} />}
    </div>
  );
}

function PointsBadge({ value, big = false }: { value: number | null; big?: boolean }) {
  const color =
    value == null || value === 0 ? "bg-gray-100 text-gray-500" : value > 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  return (
    <span className={`shrink-0 inline-flex justify-center rounded-full font-bold tabular-nums ${color} ${big ? "px-4 py-2 text-3xl" : "px-2 py-0.5 text-xs"}`}>
      {formatPoints(value)}
    </span>
  );
}

function PointsCard({ review, waiting }: { review: Review; waiting: boolean }) {
  const flags = review.highlights.filter((h) => h.points < 0).length;
  const n = review.highlights.length;
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-3">
        <PointsBadge value={review.total} big />
        <div className="text-sm text-gray-600">
          CV points {waiting && <span className="text-xs text-gray-400">(scoring…)</span>}
          <div className="text-xs text-gray-500">The sum of every point, with no limit.</div>
        </div>
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="flex justify-between font-medium">
            <span>Offer competences</span>
            <span className="tabular-nums">{formatPoints(review.auto)}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Each competence found counts once, however often the CV mentions it.
            {review.gained != null && (
              <>
                {" "}
                Here {formatPoints(review.gained)} for those found
                {review.penalties ? `, ${formatPoints(-review.penalties)} for missing core skills` : ""}.
              </>
            )}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="flex justify-between font-medium">
            <span>Recruiters&apos; points</span>
            <span className="tabular-nums">{formatPoints(review.manual)}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {n ? `${n} passage${n > 1 ? "s" : ""} scored${flags ? `, ${flags} red flag${flags > 1 ? "s" : ""}` : ""}. ` : "No passage scored. "}
            From −100 to +100 per passage, each passage once.
          </p>
        </div>
        {review.auto != null && (
          <p className="text-center text-xs text-gray-500 tabular-nums">
            {formatPoints(review.auto)} {review.manual < 0 ? "−" : "+"} {Math.abs(review.manual)} = {formatPoints(review.total)}
          </p>
        )}
      </div>
    </div>
  );
}

function CriteriaCard({ criteria, onHover }: { criteria: CriterionResult[]; onHover: (c: CriterionResult | null) => void }) {
  if (!criteria.length) return null;
  const found = criteria.filter((c) => c.found);
  const missing = criteria.filter((c) => !c.found);
  const chip = (c: CriterionResult, color: string) => (
    <li
      key={c.id}
      onMouseEnter={() => onHover(c)}
      onMouseLeave={() => onHover(null)}
      title={c.matched_terms.length ? `Found: ${c.matched_terms.join(", ")}` : undefined}
      className={`inline-flex cursor-default items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {topicName(c.label)}
      {c.points !== 0 && <span className="tabular-nums opacity-75">{formatPoints(c.points)}</span>}
    </li>
  );
  return (
    <div className={card}>
      <h3 className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">Offer competences</h3>
      <div className="p-4 space-y-3 text-sm">
        {found.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Found (hover to see them in the CV)</p>
            <ul className="flex flex-wrap gap-1.5">{found.map((c) => chip(c, "bg-green-100 text-green-800"))}</ul>
          </div>
        )}
        {missing.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Missing</p>
            <ul className="flex flex-wrap gap-1.5">
              {missing.map((c) => chip(c, c.points < 0 ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TextView({ lines, highlights, focusLines, onPick }: {
  lines: CvLine[];
  highlights: CvHighlight[];
  focusLines: number[];
  onPick: (line: CvLine, anchor: { x: number; y: number }) => void;
}) {
  const groups = useMemo(() => {
    const out: { section: string; lines: CvLine[] }[] = [];
    for (const line of lines) {
      if (out.at(-1)?.section !== line.section) out.push({ section: line.section, lines: [] });
      out.at(-1)!.lines.push(line);
    }
    return out;
  }, [lines]);

  if (!lines.length) return <p className="py-6 text-center text-sm text-gray-500">No text read from this CV.</p>;

  const pointsOf = (line: CvLine) =>
    highlights.filter((h) => h.start < line.end && h.end > line.start).reduce((sum, h) => sum + h.points, 0);

  return (
    <div className="mx-auto max-w-3xl rounded-lg bg-white p-6 shadow-sm">
      {groups.map((g, i) => (
        <section key={i} className="mb-4">
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-gray-400 uppercase">{SECTIONS[g.section] ?? g.section}</h4>
          {g.lines.map((line) => {
            const points = pointsOf(line);
            return (
              <button
                key={line.n}
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onPick(line, { x: r.left + r.width / 2, y: r.bottom });
                }}
                className={`flex w-full items-start justify-between gap-3 rounded px-2 py-0.5 text-left text-sm hover:bg-blue-50 ${
                  points < 0 ? "bg-red-100" : points ? "bg-yellow-100" : ""
                } ${focusLines.includes(line.n) ? "ring-2 ring-blue-500" : ""}`}
              >
                <span>{line.text}</span>
                {points !== 0 && (
                  <span className={`shrink-0 text-xs font-bold ${points < 0 ? "text-red-700" : "text-green-700"}`}>{formatPoints(points)}</span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
