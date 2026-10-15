"use client";

// Where a recruiter scores a passage of a CV: points from -100 to +100
// (negative for a red flag) and a comment.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

type Props = {
  quote: string;
  anchor: { x: number; y: number };
  onSubmit: (points: number, comment: string) => Promise<void>;
  onClose: () => void;
};

const WIDTH = 320;
export const MAX_POINTS = 100;

export default function ScorePopover({ quote, anchor, onSubmit, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(points);
  const valid = points.trim() !== "" && Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_POINTS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(value, comment.trim());
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "already_scored"
          ? "This passage already has points. Remove them first to score it differently."
          : e instanceof ApiError
            ? e.message
            : "Could not save the points",
      );
      setBusy(false);
    }
  }

  const left = Math.max(8, Math.min(anchor.x - WIDTH / 2, window.innerWidth - WIDTH - 8));
  const top = Math.min(anchor.y + 8, window.innerHeight - 270);

  return (
    <div ref={box} className="fixed z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-xl" style={{ left, top, width: WIDTH }}>
      <p className="line-clamp-3 border-l-2 border-blue-500 pl-2 text-xs text-gray-600 italic">{quote}</p>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
        Points
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min={-MAX_POINTS}
          max={MAX_POINTS}
          step={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. 5 or -50"
          className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-gray-500">−100 to +100</span>
      </label>
      <p className="mt-1 text-xs text-gray-500">A negative number marks a red flag.</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
        placeholder="Comment (optional)"
        rows={2}
        maxLength={2000}
        className="mt-2 w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !valid}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
            value < 0 ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {busy ? "…" : !valid ? "Give points" : value > 0 ? `Give +${value}` : `Take ${-value} away`}
        </button>
      </div>
    </div>
  );
}
