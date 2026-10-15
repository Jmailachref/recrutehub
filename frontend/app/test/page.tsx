"use client";

// The candidate's test, opened from the link in their invitation email.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, MyTest, Question, Run, takeToken, TestError } from "@/lib/candidate";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });

const LEVEL = ["", "Beginner", "Intermediate", "Advanced", "Expert", "Master"];
const LANGUAGE: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
  sql: "SQL",
  docker: "Docker",
};

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="center">
      <div className="card apply">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default function TestPage() {
  const [token, setToken] = useState<string | null>(null);
  const [test, setTest] = useState<MyTest | null>(null);
  const [problem, setProblem] = useState<"invalid" | "expired" | "offline" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t: string) => {
    try {
      setTest(await call<MyTest>(t, "/me"));
    } catch (e) {
      if (e instanceof TestError && e.status === 410) setProblem("expired");
      else if (e instanceof TestError && (e.status === 401 || e.status === 404)) setProblem("invalid");
      else setProblem("offline");
    }
  }, []);

  useEffect(() => {
    const t = takeToken();
    if (!t) {
      setProblem("invalid");
      return;
    }
    setToken(t);
    load(t);
    // Opening another test link in this tab only changes the #fragment, which
    // does not reload the page: start over with the new link's test.
    const onHash = () => {
      if (window.location.hash.length > 1) window.location.reload();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [load]);

  async function start() {
    if (!token) return;
    setBusy(true);
    try {
      setTest(await call<MyTest>(token, "/me/start", { method: "POST" }));
    } catch (e) {
      if (e instanceof TestError && e.status === 410) setProblem("expired");
      else setProblem("offline");
    }
    setBusy(false);
  }

  if (problem === "invalid")
    return (
      <Message title="This test link is not valid">
        <p className="muted">Open the link from your invitation email again. It works for 7 days.</p>
      </Message>
    );
  if (problem === "expired" || test?.status === "expired")
    return (
      <Message title="This test link has expired">
        <p className="muted">Links work for 7 days. Contact the recruiter if you still want to take the test.</p>
      </Message>
    );
  if (problem === "offline")
    return (
      <Message title="Could not reach the server">
        <p className="muted">Check your connection and reload the page. Your saved answers are kept.</p>
      </Message>
    );
  if (!test || !token) return <main className="center muted">Loading…</main>;

  if (test.status === "submitted" || test.status === "scored")
    return (
      <Message title="Thank you, your test is submitted">
        <p className="muted">
          Your answers for {test.offer_title} were sent. You will get a confirmation email, and the recruiter will be in
          touch.
        </p>
      </Message>
    );

  if (test.status === "invited")
    return (
      <main className="apply-page">
        <article className="card apply stack">
          <p className="muted small">Online test</p>
          <h1>{test.offer_title}</h1>
          <p>Hello {test.candidate_name},</p>
          <p>
            The test has <strong>{test.question_count} questions</strong>: {test.code_count} to solve in code and{" "}
            {test.qcm_count} multiple choice. You have <strong>{Math.round(test.duration_seconds / 60)} minutes</strong>{" "}
            in total.
          </p>
          <ul className="rules">
            <li>The timer starts when you press Start and does not pause, even if you close the page.</li>
            <li>Answers save as you go. You can move between questions freely.</li>
            <li>Code questions show example tests you can run. Hidden tests check your code after you submit.</li>
            <li>When time runs out, the answers you saved are submitted.</li>
          </ul>
          <button onClick={start} disabled={busy}>
            {busy ? "Starting…" : "Start the test"}
          </button>
        </article>
      </main>
    );

  return <Running token={token} initial={test} onEnded={() => load(token)} />;
}

function Running({ token, initial, onEnded }: { token: string; initial: MyTest; onEnded: () => void }) {
  const [questions, setQuestions] = useState<Question[]>(initial.questions);
  const [current, setCurrent] = useState(0);
  const [left, setLeft] = useState(initial.seconds_left ?? 0);
  const [saving, setSaving] = useState<"saved" | "saving" | "failed">("saved");
  const [confirm, setConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const deadline = useRef(Date.now() + (initial.seconds_left ?? 0) * 1000);

  const save = useCallback(
    async (q: Question, body: object) => {
      setSaving("saving");
      try {
        await call(token, `/me/answers/${q.id}`, { method: "PUT", body: JSON.stringify(body) });
        setSaving("saved");
      } catch (e) {
        if (e instanceof TestError && e.code === "test_not_running") onEnded();
        else setSaving("failed");
      }
    },
    [token, onEnded],
  );

  const finish = useCallback(async () => {
    setEnding(true);
    // Flush answers still waiting for their save.
    for (const t of Object.values(timers.current)) clearTimeout(t);
    await Promise.all(
      questions
        .filter((q) => q.kind === "code" && q.answer_source !== null)
        .map((q) => call(token, `/me/answers/${q.id}`, { method: "PUT", body: JSON.stringify({ source_code: q.answer_source }) }).catch(() => {})),
    );
    await call(token, "/me/submit", { method: "POST" }).catch(() => {});
    onEnded();
  }, [questions, token, onEnded]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(id);
        finish();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [finish]);

  function update(q: Question, patch: Partial<Question>) {
    setQuestions((all) => all.map((x) => (x.id === q.id ? { ...x, ...patch } : x)));
  }

  function pick(q: Question, index: number) {
    const now = q.answer_choices ?? [];
    const next = q.multiple ? (now.includes(index) ? now.filter((i) => i !== index) : [...now, index]) : [index];
    update(q, { answer_choices: next });
    save(q, { choices: next });
  }

  function edit(q: Question, source: string) {
    update(q, { answer_source: source });
    setSaving("saving");
    clearTimeout(timers.current[q.id]);
    timers.current[q.id] = setTimeout(() => save(q, { source_code: source }), 800);
  }

  const q = questions[current];
  const answered = (x: Question) =>
    x.kind === "qcm" ? (x.answer_choices?.length ?? 0) > 0 : (x.answer_source ?? "").trim() !== "" && x.answer_source !== x.starter_code;
  const done = questions.filter(answered).length;

  return (
    <div className="test-shell">
      <header className="topbar test-bar">
        <strong className="brand">{initial.offer_title}</strong>
        <span className="muted small num">
          {done}/{questions.length} answered
        </span>
        <span className="spacer" />
        <span className={`small ${saving === "failed" ? "error" : "muted"}`}>
          {saving === "saving" ? "Saving…" : saving === "failed" ? "Not saved, retrying on your next change" : "All changes saved"}
        </span>
        <span className={`clock num ${left < 300 ? "clock-low" : ""}`} aria-live="off">
          {clock(left)}
        </span>
        {confirm ? (
          <>
            <button onClick={finish} disabled={ending}>
              {ending ? "Submitting…" : "Yes, submit now"}
            </button>
            <button className="secondary" onClick={() => setConfirm(false)} disabled={ending}>
              Keep working
            </button>
          </>
        ) : (
          <button onClick={() => setConfirm(true)}>Submit test</button>
        )}
      </header>
      {confirm && (
        <p className="confirm-note">
          {questions.length - done > 0
            ? `${questions.length - done} question${questions.length - done > 1 ? "s are" : " is"} still unanswered. `
            : ""}
          After submitting you cannot change your answers.
        </p>
      )}
      <div className="test-body">
        <nav className="q-list" aria-label="Questions">
          {questions.map((x, i) => (
            <button
              key={x.id}
              className={`q-item ${i === current ? "q-current" : ""}`}
              onClick={() => setCurrent(i)}
              aria-current={i === current}
            >
              <span className="num">{i + 1}</span>
              <span className="q-meta">
                {x.kind === "code" ? "Code" : "QCM"} · {LANGUAGE[x.language] ?? x.language}
              </span>
              <span className={answered(x) ? "q-dot q-done" : "q-dot"} aria-label={answered(x) ? "answered" : "not answered"} />
            </button>
          ))}
        </nav>
        <section className="q-main">
          <p className="muted small">
            Question {current + 1} of {questions.length} · {LANGUAGE[q.language] ?? q.language} · {LEVEL[q.level]} · about{" "}
            {Math.round(q.timer_seconds / 60)} min
          </p>
          <h1>{q.title}</h1>
          <div className="statement">{q.statement}</div>
          {q.kind === "qcm" ? (
            <Choices q={q} onPick={(i) => pick(q, i)} />
          ) : (
            <CodeAnswer key={q.id} token={token} q={q} onEdit={(s) => edit(q, s)} />
          )}
          <div className="q-nav">
            <button className="secondary" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
              Previous
            </button>
            <button className="secondary" disabled={current === questions.length - 1} onClick={() => setCurrent(current + 1)}>
              Next
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Choices({ q, onPick }: { q: Question; onPick: (i: number) => void }) {
  const picked = q.answer_choices ?? [];
  return (
    <fieldset className="choices">
      <legend className="muted small">{q.multiple ? "Pick every option that applies." : "Pick one option."}</legend>
      {q.choices?.map((c, i) => (
        <label key={i} className={`choice ${picked.includes(i) ? "choice-on" : ""}`}>
          <input
            type={q.multiple ? "checkbox" : "radio"}
            name={q.id}
            checked={picked.includes(i)}
            onChange={() => onPick(i)}
          />
          <span>{c}</span>
        </label>
      ))}
    </fieldset>
  );
}

function CodeAnswer({ token, q, onEdit }: { token: string; q: Question; onEdit: (s: string) => void }) {
  const source = q.answer_source ?? q.starter_code ?? "";
  const [results, setResults] = useState<Record<number, Run | "running" | string>>({});

  async function runExample(i: number) {
    setResults((r) => ({ ...r, [i]: "running" }));
    try {
      const { id } = await call<{ id: string }>(token, "/me/runs", {
        method: "POST",
        body: JSON.stringify({ problem_id: q.id, source_code: source, stdin: q.examples[i].input }),
      });
      for (let tries = 0; tries < 60; tries++) {
        await new Promise((ok) => setTimeout(ok, 700));
        const run = await call<Run>(token, `/me/runs/${id}`);
        if (run.status === "completed" || run.status === "failed") return setResults((r) => ({ ...r, [i]: run }));
      }
      setResults((r) => ({ ...r, [i]: "The run took too long. Try again." }));
    } catch (e) {
      setResults((r) => ({ ...r, [i]: e instanceof TestError ? e.message : "Could not run the code." }));
    }
  }

  return (
    <>
      <CodeEditor language={q.language} value={source} onChange={onEdit} />
      <h2 className="examples-title">Example tests</h2>
      {q.examples.length === 0 && <p className="muted small">This question has no example test; hidden tests check it after you submit.</p>}
      {q.examples.map((ex, i) => {
        const r = results[i];
        const run = typeof r === "object" ? r : null;
        const passed = run && run.verdict === "accepted" && run.stdout.trimEnd() === ex.expected_output.trimEnd();
        return (
          <div key={i} className="example">
            <div className="example-head">
              <strong>{ex.name}</strong>
              <span className="spacer" />
              {run && <span className={passed ? "ok" : "error"}>{passed ? "Passed" : "Not passing"}</span>}
              <button className="secondary" onClick={() => runExample(i)} disabled={r === "running"}>
                {r === "running" ? "Running…" : "Run"}
              </button>
            </div>
            <div className="io">
              <div>
                <p className="muted small">Input</p>
                <pre>{ex.input || "(empty)"}</pre>
              </div>
              <div>
                <p className="muted small">Expected output</p>
                <pre>{ex.expected_output || "(empty)"}</pre>
              </div>
              {run && (
                <div>
                  <p className="muted small">Your output{run.time_ms != null ? ` · ${run.time_ms} ms` : ""}</p>
                  <pre>{run.compile_output || run.stdout || run.stderr || "(empty)"}</pre>
                  {run.stderr && run.stdout && <pre className="error">{run.stderr}</pre>}
                </div>
              )}
            </div>
            {typeof r === "string" && r !== "running" && <p className="error small">{r}</p>}
          </div>
        );
      })}
      {q.hidden_tests > 0 && (
        <p className="muted small">
          {q.hidden_tests} hidden test{q.hidden_tests > 1 ? "s" : ""} also check your code after you submit.
        </p>
      )}
    </>
  );
}
