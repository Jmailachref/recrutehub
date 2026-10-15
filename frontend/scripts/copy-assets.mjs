// Copies Monaco's prebuilt files and the PDF reader's worker into public/ so
// they load from this site instead of a CDN (candidates may be behind strict networks).
import { copyFileSync, cpSync, rmSync } from "node:fs";

rmSync("public/monaco", { recursive: true, force: true });
cpSync("node_modules/monaco-editor/min/vs", "public/monaco/vs", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
