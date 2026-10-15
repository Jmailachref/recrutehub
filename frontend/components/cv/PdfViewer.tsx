"use client";

// The CV itself, page by page, with its text selectable: a selection becomes a
// passage to score. Load it with next/dynamic and ssr: false (pdf.js needs a browser).
import * as pdfjs from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { useEffect, useRef, useState } from "react";

import type { Box } from "@/lib/api";

// Copied into public/ by scripts/copy-assets.mjs.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export type Mark = { id: string; boxes: Box[]; points: number; active?: boolean };

export type Selection = {
  quote: string;
  page: number;
  boxes: Box[];
  // Where to show the scoring popover, in viewport pixels.
  anchor: { x: number; y: number };
};

type Props = {
  url: string;
  marks: Mark[];
  // Boxes drawn as outlines, e.g. the lines where a skill was found.
  focus?: Box[];
  onSelect: (selection: Selection) => void;
  onMarkClick?: (id: string) => void;
};

type PageSize = { width: number; height: number };

// Yellow for points given, red for points taken away (a red flag), darker past 20 points.
const markColor = (points: number) =>
  points < 0 ? (points <= -20 ? "bg-red-500/45" : "bg-red-400/35") : points >= 20 ? "bg-amber-400/50" : "bg-yellow-300/45";

// Boxes are in PDF points from the page's top left corner, as the engine stores line boxes.
export default function PdfViewer({ url, marks, focus = [], onSelect, onMarkClick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument(url);
    task.promise.then(
      async (pdf) => {
        const pages = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then((p) => p.getViewport({ scale: 1 }))),
        );
        if (cancelled) return;
        setSizes(pages.map((v) => ({ width: v.width, height: v.height })));
        setDoc(pdf);
      },
      (e) => !cancelled && setError(String(e?.message ?? e)),
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url]);

  // Fit the page width to the viewer, and follow it when the window is resized.
  useEffect(() => {
    if (!root.current || !sizes.length) return;
    const fit = () => {
      const width = root.current!.clientWidth - 2;
      setScale(Math.min(2, Math.max(0.5, width / Math.max(...sizes.map((s) => s.width)))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [sizes]);

  // A selection made in a page's text layer becomes a passage to score.
  const onMouseUp = () => {
    const selection = window.getSelection();
    // Drop the punctuation a drag tends to catch at either end.
    const quote = selection?.toString().replace(/^[\s:;,.·•|–—-]+|[\s:;,.·•|–—-]+$/g, "");
    if (!selection || !quote || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const pageEl = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>("[data-page]");
    if (!pageEl || !root.current?.contains(pageEl)) return;
    const page = Number(pageEl.dataset.page);
    const origin = pageEl.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 1 && r.top >= origin.top - 1 && r.bottom <= origin.bottom + 1,
    );
    if (!rects.length) return;
    const boxes = rects.slice(0, 100).map((r) => ({
      page,
      x0: round((r.left - origin.left) / scale),
      top: round((r.top - origin.top) / scale),
      x1: round((r.right - origin.left) / scale),
      bottom: round((r.bottom - origin.top) / scale),
    }));
    const last = rects[rects.length - 1];
    onSelect({ quote, page, boxes, anchor: { x: last.right, y: last.bottom } });
  };

  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-800">The PDF does not open: {error}</div>;

  return (
    <div ref={root} onMouseUp={onMouseUp} className="space-y-4">
      {!doc && <p className="py-12 text-center text-sm text-gray-400">Opening the CV…</p>}
      {doc &&
        sizes.map((size, i) => (
          <PdfPage
            key={i}
            doc={doc}
            number={i + 1}
            size={size}
            scale={scale}
            marks={marks}
            focus={focus.filter((b) => b.page === i + 1)}
            onMarkClick={onMarkClick}
          />
        ))}
    </div>
  );
}

function PdfPage({ doc, number, size, scale, marks, focus, onMarkClick }: {
  doc: pdfjs.PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
  marks: Mark[];
  focus: Box[];
  onMarkClick?: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let render: pdfjs.RenderTask | null = null;
    let layer: pdfjs.TextLayer | null = null;
    doc.getPage(number).then((page) => {
      if (cancelled || !canvas.current || !text.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const el = canvas.current;
      el.width = Math.floor(viewport.width * ratio);
      el.height = Math.floor(viewport.height * ratio);
      render = page.render({
        canvasContext: el.getContext("2d")!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      render.promise.catch(() => undefined);
      text.current.replaceChildren();
      layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport });
      layer.render().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, number, scale]);

  const style = (b: Box) => ({
    left: b.x0 * scale,
    top: b.top * scale,
    width: (b.x1 - b.x0) * scale,
    height: (b.bottom - b.top) * scale,
  });

  return (
    <div
      data-page={number}
      className="relative mx-auto overflow-hidden bg-white shadow-md ring-1 ring-gray-200"
      style={{ width: size.width * scale, height: size.height * scale, ["--scale-factor" as string]: scale }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {/* Marks sit under the text layer so the text stays selectable; a click on a mark goes through the text. */}
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {marks.flatMap((m) =>
          m.boxes
            .filter((b) => b.page === number)
            .map((b, j) => (
              <div
                key={`${m.id}-${j}`}
                className={`absolute rounded-sm mix-blend-multiply ${markColor(m.points)} ${m.active ? "ring-2 ring-blue-600" : ""}`}
                style={style(b)}
              />
            )),
        )}
        {focus.map((b, j) => (
          <div key={`f-${j}`} className="absolute rounded-sm bg-blue-500/10 ring-2 ring-blue-500" style={style(b)} />
        ))}
      </div>
      <div
        ref={text}
        className="textLayer"
        style={{ zIndex: 2 }}
        onClick={(e) => {
          if (!onMarkClick || window.getSelection()?.toString()) return;
          const page = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - page.left) / scale;
          const y = (e.clientY - page.top) / scale;
          const hit = marks.find((m) => m.boxes.some((b) => b.page === number && x >= b.x0 && x <= b.x1 && y >= b.top && y <= b.bottom));
          if (hit) onMarkClick(hit.id);
        }}
      />
      <span className="absolute right-2 bottom-1 z-[3] text-[10px] text-gray-400 select-none">{number}</span>
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
