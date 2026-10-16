"use client";

// One candidate: profile, CV (scored in points, annotated by recruiters), test scores and every answer.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  Candidate,
  candidateStatusLabel,
  formatPoints,
  levelLabel,
  pointsColor,
  scoreColor,
  TestAnswer,
  TestDetail,
  TestSummary,
  testStatusLabel,
  topicName,
  verdictLabel,
} from "@/lib/api";
import CvReview from "@/components/cv/CvReview";
import { useUser } from "../../../../AppShell";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });

const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "—");

export default function CandidateProfilePage() {
  const { id: offerId, cid } = useParams<{ id: string; cid: string }>();
  const user = useUser();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [session, setSession] = useState<TestDetail | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  // The CV's points, kept up to date as recruiters score passages below.
  const [cvPoints, setCvPoints] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [c, tests] = await Promise.all([
        api<Candidate>(`/api/candidates/candidates/${cid}`),
        api<TestSummary[]>(`/api/assessments/sessions?offer_id=${offerId}`),
      ]);
      setCandidate(c);
      const mine = tests.find((t) => t.candidate_id === cid);
      setSession(mine ? await api<TestDetail>(`/api/assessments/sessions/${mine.id}`) : null);
      const scored = tests.filter((t) => t.total_score != null).sort((a, b) => b.total_score! - a.total_score!);
      const at = scored.findIndex((t) => t.candidate_id === cid);
      setRank(at >= 0 ? at + 1 : null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "Candidate not found" : "Failed to load candidate");
    } finally {
      setLoading(false);
    }
  }, [cid, offerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function invite() {
    setInviting(true);
    setError("");
    try {
      await api("/api/assessments/sessions", { method: "POST", body: JSON.stringify({ candidate_id: cid }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the invitation");
    }
    setInviting(false);
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!candidate) return <p className="text-red-600">{error}</p>;

  const canInvite = user?.role === "admin" || user?.role === "recruiter";
  const points = cvPoints === undefined ? candidate.cv_score : cvPoints;

  return (
    <div>
      <div className="mb-5 text-sm text-gray-500 flex flex-wrap gap-2">
        <Link href="/dashboard" className="hover:text-blue-600">
          Dashboard
        </Link>
        <span>/</span>
        <Link href={`/offers/${offerId}`} className="hover:text-blue-600">
          {session?.offer_title ?? "Offer"}
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{candidate.name}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{candidate.name}</h1>
            <p className="text-gray-600 mt-0.5 break-all">{candidate.email}</p>
            {candidate.phone && <p className="text-gray-500 text-sm">{candidate.phone}</p>}
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 mt-2 inline-block">
              {candidateStatusLabel[candidate.status]}
            </span>
          </div>
          <div className="text-right text-sm text-gray-500 shrink-0">
            {rank && (
              <p className="mb-1">
                Rank <span className="font-bold text-gray-800">#{rank}</span>
              </p>
            )}
            <p>Applied {new Date(candidate.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-gray-100 pt-4">
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${pointsColor(points)}`}>{formatPoints(points)}</p>
            <p className="text-xs text-gray-500 mt-0.5">CV points</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${scoreColor(session?.total_score)}`}>{fmt(session?.total_score)}</p>
            <p className="text-xs text-gray-500 mt-0.5">Final Score</p>
          </div>
          <div className="text-center self-center text-sm">
            {candidate.cv_missing.length > 0 ? (
              <p className="text-red-700">Missing core skills: {candidate.cv_missing.map(topicName).join(", ")}</p>
            ) : candidate.cv_status === "ready" ? (
              <p className="text-green-700">Every core skill found</p>
            ) : (
              <p className="text-gray-400">{candidate.cv_status ? "The CV is being read" : "CV not read yet"}</p>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <CvReview candidateId={candidate.id} canScore={canInvite} onPoints={setCvPoints} />

      {session ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Test Session</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                session.status === "scored" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
              }`}
            >
              {testStatusLabel[session.status]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
            {[
              { label: `Theory (QCM, numbers) · ${Math.round(session.weight_theory * 100)}%`, value: session.theory_score },
              { label: `Practice (code) · ${Math.round(session.weight_practice * 100)}%`, value: session.practice_score },
            ].map((s) => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${scoreColor(s.value)}`}>{fmt(s.value)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 mb-4">
            Invited {new Date(session.invited_at).toLocaleString()}
            {session.started_at && <> · Started {new Date(session.started_at).toLocaleString()}</>}
            {session.submitted_at && <> · Submitted {new Date(session.submitted_at).toLocaleString()}</>}
          </p>
          {session.status === "submitted" && (
            <p className="text-sm text-gray-500 mb-4">The code answers are being judged. Reload in a moment.</p>
          )}
          {(session.status === "invited" || session.status === "in_progress") && (
            <p className="text-sm text-gray-500 mb-4">Scores appear once the candidate submits the test.</p>
          )}

          <div className="space-y-4">
            {session.answers.map((a) => (
              <Answer key={a.problem_id} a={a} />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500 text-sm">
          <p>No test session yet.</p>
          {canInvite && (
            <button
              onClick={invite}
              disabled={inviting}
              className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {inviting ? "Sending…" : "Invite to test"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Answer({ a }: { a: TestAnswer }) {
  const done = a.score != null;
  const right = a.score === 1;
  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-medium text-gray-800">
          Q{a.position + 1}. {a.title}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap">
            {a.kind === "numeric" ? "number" : a.kind} · {a.skill ?? topicName(a.language)} · {levelLabel[a.level]}
          </span>
          {done && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${right ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
              {a.kind === "code" ? `${Math.round(a.score! * 100)}%` : right ? "Correct" : "Wrong"}
            </span>
          )}
        </div>
      </div>
      <details className="mb-2">
        <summary className="text-xs text-gray-500 cursor-pointer">Statement</summary>
        <div className="text-sm text-gray-700 whitespace-pre-wrap mt-2">{a.statement}</div>
      </details>
      {a.kind === "qcm" ? (
        <div className="space-y-1.5">
          {a.options?.map((o, i) => {
            const picked = a.choices?.includes(i);
            const correct = a.correct_choices?.includes(i);
            return (
              <div
                key={i}
                className={`flex items-start gap-2 text-sm rounded px-2 py-1.5 border ${
                  correct ? "border-green-300 bg-green-50" : picked ? "border-red-300 bg-red-50" : "border-gray-100"
                }`}
              >
                <span className="tabular-nums">{picked ? "☑" : "☐"}</span>
                <span className="whitespace-pre-wrap flex-1">{o}</span>
                {correct && <span className="text-xs text-green-700">right answer</span>}
              </div>
            );
          })}
        </div>
      ) : a.kind === "numeric" ? (
        <div className="text-sm space-y-1">
          <p>
            <span className="text-gray-500">Answered:</span>{" "}
            <span className={`font-semibold tabular-nums ${right ? "text-green-700" : "text-red-600"}`}>
              {a.value ?? "no answer"} {a.value != null && a.unit}
            </span>
          </p>
          <p className="text-gray-500">
            Right answer: <span className="tabular-nums text-gray-800">{a.answer_value} {a.unit}</span>
            {a.tolerance ? ` (± ${a.tolerance})` : ""}
          </p>
          {a.explanation && <p className="text-xs text-gray-500 whitespace-pre-wrap">{a.explanation}</p>}
        </div>
      ) : a.source_code ? (
        <>
          <CodeEditor language={a.language} value={a.source_code} readOnly light height={`${Math.min(420, a.source_code.split("\n").length * 19 + 24)}px`} />
          {a.verdict && (
            <p className="mt-2 text-xs text-gray-500">
              <span className="font-medium">Verdict:</span>{" "}
              <span className={right ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{verdictLabel[a.verdict] ?? a.verdict}</span>
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400">No code was submitted.</p>
      )}
    </div>
  );
}
