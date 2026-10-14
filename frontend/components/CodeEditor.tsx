"use client";

import Editor, { loader } from "@monaco-editor/react";

// Monaco is served from this site (public/monaco, copied at build time).
loader.config({ paths: { vs: "/monaco/vs" } });

// Code Playground language ids → Monaco's.
const MONACO_LANGUAGE: Record<string, string> = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "cpp",
  go: "go",
  sql: "sql",
};

export default function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  height = "420px",
}: {
  language: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}) {
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return (
    <div className="editor">
      <Editor
        height={height}
        language={MONACO_LANGUAGE[language] ?? "plaintext"}
        value={value}
        theme={dark ? "vs-dark" : "vs"}
        onChange={(v) => onChange?.(v ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
        }}
        loading={<p className="muted small">Loading the editor…</p>}
      />
    </div>
  );
}
