// Copies Monaco's prebuilt files into public/ so the editor loads from this
// site instead of a CDN (candidates may be behind strict networks).
import { cpSync, rmSync } from "node:fs";

rmSync("public/monaco", { recursive: true, force: true });
cpSync("node_modules/monaco-editor/min/vs", "public/monaco/vs", { recursive: true });
