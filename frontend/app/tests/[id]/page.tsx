"use client";

// One candidate's test, as the recruiter sees it: scores and every answer.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, levelLabel, TestAnswer, TestDetail, testStatusLabel, verdictLabel } from "@/lib/api";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });

function pct(v: number | null): string {
  return v == null ? "–" : `${Math.round(v)}%`;
}

export default function TestResults() {
  const { id } = useParams<{ id: string }>();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<TestDetail>(`/api/assessments/sessions/${id}`)
      .then(setTest)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the test"));
  }, [id]);

  if (!test) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const scored = test.status === "scored";
  return (
    <>
      <p className="small">
        <Link href={`/candidates?offer=${test.offer_id}`}>← Candidates for {test.offer_title}</Link>
      </p>
      <div className="title-row">
        <h1>{test.candidate_name}</h1>
        <span className={`status ${scored ? "status-active" : ""}`}>{testStatusLabel[test.status]}</span>
      </div>
      <p className="muted">
        {test.candidate_email} · invited {new Date(test.invited_at).toLocaleDateString()}
        {test.submitted_at && ` · submitted ${new Date(test.submitted_at).toLocaleString()}`}
      </p>

      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="muted small">Total</p>
          <p className="num" style={{ fontSize: 28, margin: 0 }}>{pct(test.total_score)}</p>
        </div>
        <div className="card">
          <p className="muted small">Practice (code) · weight {Math.round(test.weight_practice * 100)}%</p>
          <p className="num" style={{ fontSize: 28, margin: 0 }}>{pct(test.practice_score)}</p>
        </div>
        <div className="card">
          <p className="muted small">Theory (QCM) · weight {Math.round(test.weight_theory * 100)}%</p>
          <p className="num" style={{ fontSize: 28, margin: 0 }}>{pct(test.theory_score)}</p>
        </div>
      </div>
      {!scored && (
        <p className="muted">
          {test.status === "submitted"
            ? "The code answers are being judged. Reload in a moment."
            : "Scores appear once the candidate submits the test."}
        </p>
      )}

      <div className="stack">
        {test.answers.map((a) => (
          <Answer key={a.problem_id} a={a} />
        ))}
      </div>
    </>
  );
}

function Answer({ a }: { a: TestAnswer }) {
  const ok = a.score === 1;
  return (
    <section className="card answer">
      <div className="answer-head">
        <h2>
          {a.position + 1}. {a.title}
        </h2>
        <span className="muted small">
          {a.kind === "code" ? "Code" : "QCM"} · {a.language} · {levelLabel[a.level]}
        </span>
        <span className="spacer" />
        {a.verdict && <span className={ok ? "ok" : "error"}>{verdictLabel[a.verdict] ?? a.verdict}</span>}
        {a.score != null && <span className="num score">{Math.round(a.score * 100)}%</span>}
      </div>
      <details>
        <summary className="small">Statement</summary>
        <div className="statement small">{a.statement}</div>
      </details>
      {a.kind === "qcm" ? (
        <div className="choices">
          {a.options?.map((o, i) => {
            const picked = a.choices?.includes(i);
            const right = a.correct_choices?.includes(i);
            return (
              <div key={i} className={`choice ${right ? "choice-right" : picked ? "choice-wrong" : ""}`}>
                <span className="num">{picked ? "☑" : "☐"}</span>
                <span>{o}</span>
                {right && <span className="ok small">right answer</span>}
              </div>
            );
          })}
        </div>
      ) : a.source_code ? (
        <CodeEditor language={a.language} value={a.source_code} readOnly height="260px" />
      ) : (
        <p className="muted">No code was submitted.</p>
      )}
    </section>
  );
}
