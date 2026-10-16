"use client";

// The test library: domains, their skills, and the company's questions per skill and level.
// Anyone writes questions or proposes corrections; a more experienced colleague (or an admin)
// validates them before they go into tests.
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  BankQuestion,
  BankQuestionDetail,
  Domain,
  experienceLabel,
  levelLabel,
  LibraryMe,
  LibraryQuestion,
  LibraryQuestionSummary,
  LibrarySkill,
  questionStatusColor,
  questionStatusLabel,
} from "@/lib/api";

type Tab = "skills" | "review" | "mine";

type Draft = {
  skill_id: string;
  level: number;
  kind: "qcm" | "numeric";
  title: string;
  statement: string;
  choices: string[];
  correct_choices: number[];
  answer_value: string;
  tolerance: string;
  unit: string;
  explanation: string;
  timer_seconds: number;
};

// What the editor is doing: writing a new question, rewriting one, or correcting an approved one.
type Editing = { mode: "new" | "edit" | "correct"; id?: string; draft: Draft };

const field = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
const small = "border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";

function emptyDraft(skillId: string, level = 2): Draft {
  return {
    skill_id: skillId,
    level,
    kind: "qcm",
    title: "",
    statement: "",
    choices: ["", ""],
    correct_choices: [],
    answer_value: "",
    tolerance: "",
    unit: "",
    explanation: "",
    timer_seconds: 120,
  };
}

function draftOf(q: LibraryQuestion): Draft {
  return {
    skill_id: q.skill_id,
    level: q.level,
    kind: q.kind,
    title: q.title,
    statement: q.statement,
    choices: q.choices ?? ["", ""],
    correct_choices: q.correct_choices ?? [],
    answer_value: q.answer_value == null ? "" : String(q.answer_value),
    tolerance: q.tolerance ? String(q.tolerance) : "",
    unit: q.unit ?? "",
    explanation: q.explanation,
    timer_seconds: q.timer_seconds,
  };
}

const number = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));

function Status({ status }: { status: LibraryQuestionSummary["status"] }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${questionStatusColor[status]}`}>{questionStatusLabel[status]}</span>;
}

function QuestionRows({ questions, onOpen, showSkill }: { questions: LibraryQuestionSummary[]; onOpen: (id: string) => void; showSkill?: boolean }) {
  if (questions.length === 0) return <p className="text-sm text-gray-400 py-6 text-center">No questions here yet.</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {questions.map((q) => (
        <li key={q.id}>
          <button onClick={() => onOpen(q.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-900 truncate">
                {q.replaces_id && <span className="text-xs text-blue-600 mr-1">Correction ·</span>}
                {q.title}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">
                {showSkill && `${q.domain} › ${q.skill} · `}
                Level {q.level} · {q.kind === "qcm" ? "QCM" : "Number"} · by {q.author.name}
                {q.author.experience ? ` (${experienceLabel[q.author.experience]})` : ""}
              </span>
            </span>
            <Status status={q.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryPage() {
  const [me, setMe] = useState<LibraryMe | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [tab, setTab] = useState<Tab>("skills");
  const [skillId, setSkillId] = useState("");
  const [level, setLevel] = useState(0);
  const [questions, setQuestions] = useState<LibraryQuestionSummary[]>([]);
  const [reviews, setReviews] = useState<LibraryQuestionSummary[]>([]);
  const [mine, setMine] = useState<LibraryQuestionSummary[]>([]);
  const [open, setOpen] = useState<LibraryQuestion | null>(null);
  const [bankList, setBankList] = useState<BankQuestion[]>([]);
  const [openBank, setOpenBank] = useState<BankQuestionDetail | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const skills = useMemo(() => domains.flatMap((d) => d.skills), [domains]);
  const skill = skills.find((s) => s.id === skillId) ?? null;

  const loadCatalog = useCallback(() => api<Domain[]>("/api/questions/catalog").then(setDomains), []);
  const loadLists = useCallback(async () => {
    const [r, m] = await Promise.all([
      api<LibraryQuestionSummary[]>("/api/questions/reviews"),
      api<LibraryQuestionSummary[]>("/api/questions/questions?mine=true"),
    ]);
    setReviews(r);
    setMine(m);
  }, []);
  const builtin = skill?.builtin ?? false;
  const loadSkill = useCallback(async () => {
    if (!skillId) return setQuestions([]);
    const params = new URLSearchParams({ skill_id: skillId });
    if (level) params.set("level", String(level));
    setQuestions(await api<LibraryQuestionSummary[]>(`/api/questions/questions?${params}`));
    // Built-in skills also show the shared bank's questions, which every company's tests draw.
    setBankList(builtin ? await api<BankQuestion[]>(`/api/questions/skills/${skillId}/bank${level ? `?level=${level}` : ""}`).catch(() => []) : []);
  }, [skillId, level, builtin]);

  useEffect(() => {
    Promise.all([api<LibraryMe>("/api/questions/me").then(setMe), loadCatalog(), loadLists()]).catch((e) =>
      setError(e instanceof ApiError ? e.message : "The library is not reachable right now"),
    );
  }, [loadCatalog, loadLists]);

  useEffect(() => {
    loadSkill().catch(() => setQuestions([]));
  }, [loadSkill]);

  async function refresh() {
    await Promise.all([loadCatalog(), loadLists(), loadSkill()]);
  }

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | null> {
    setError("");
    setBusy(true);
    try {
      return await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openShared(id: string) {
    setEditing(null);
    setOpen(null);
    const q = await run(() => api<BankQuestionDetail>(`/api/questions/skills/${skillId}/bank/${id}`), "Could not open the question");
    if (q) setOpenBank(q);
  }

  async function copyShared() {
    if (!openBank) return;
    const q = await run(
      () =>
        api<LibraryQuestion>(`/api/questions/skills/${skillId}/bank/${openBank.id}/copy`, {
          method: "POST",
          body: JSON.stringify({ skill_id: skillId }),
        }),
      "Could not copy the question",
    );
    if (q) {
      setOpenBank(null);
      setEditing({ mode: "edit", id: q.id, draft: draftOf(q) });
      await refresh();
    }
  }

  async function openQuestion(id: string) {
    setEditing(null);
    setOpenBank(null);
    const q = await run(() => api<LibraryQuestion>(`/api/questions/questions/${id}`), "Could not open the question");
    if (q) setOpen(q);
  }

  async function saveQuestion(submit: boolean) {
    if (!editing) return;
    const d = editing.draft;
    const body = JSON.stringify({
      skill_id: d.skill_id,
      level: d.level,
      kind: d.kind,
      title: d.title,
      statement: d.statement,
      choices: d.kind === "qcm" ? d.choices : null,
      correct_choices: d.kind === "qcm" ? d.correct_choices : null,
      answer_value: d.kind === "numeric" ? number(d.answer_value) : null,
      tolerance: d.kind === "numeric" ? number(d.tolerance) : null,
      unit: d.kind === "numeric" ? d.unit || null : null,
      explanation: d.explanation,
      timer_seconds: d.timer_seconds,
      submit,
    });
    const url =
      editing.mode === "new"
        ? "/api/questions/questions"
        : editing.mode === "edit"
          ? `/api/questions/questions/${editing.id}`
          : `/api/questions/questions/${editing.id}/corrections`;
    const q = await run(() => api<LibraryQuestion>(url, { method: editing.mode === "edit" ? "PUT" : "POST", body }), "Could not save the question");
    if (q) {
      setEditing(null);
      setOpen(q);
      await refresh();
    }
  }

  async function act(path: string, body?: object) {
    if (!open) return;
    const q = await run(
      () => api<LibraryQuestion>(`/api/questions/questions/${open.id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
      "Could not update the question",
    );
    if (q) {
      setOpen(q);
      await refresh();
    }
  }

  async function remove() {
    if (!open || !confirm("Delete this question?")) return;
    const ok = await run(() => api(`/api/questions/questions/${open.id}`, { method: "DELETE" }), "Could not delete the question");
    if (ok !== null) {
      setOpen(null);
      await refresh();
    }
  }

  if (!me && !error) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800">Library</h1>
      <p className="text-gray-500 text-sm mt-1 mb-6">
        Domains, their skills and your questions per level. Questions go into tests once a more experienced colleague, or an admin,
        validates them.
        {me && (
          <>
            {" "}
            {me.role === "admin" ? (
              "As an admin you validate any question, your own included."
            ) : (
              <>
                You are <strong className="text-gray-700">{me.experience_label}</strong>
                {me.experience > 1
                  ? `: you validate questions written by ${Object.entries(experienceLabel)
                      .filter(([v]) => Number(v) < me.experience)
                      .map(([, l]) => l)
                      .join(", ")} colleagues.`
                  : ": a more experienced colleague validates your questions."}
              </>
            )}
          </>
        )}
      </p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(
          [
            ["skills", "Domains & skills"],
            ["review", `To validate${reviews.length ? ` (${reviews.length})` : ""}`],
            ["mine", "My questions"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t ? "border-blue-600 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0">
          {tab === "skills" && (
            <Catalog
              domains={domains}
              me={me}
              skillId={skillId}
              onPick={(id) => {
                setSkillId(id);
                setLevel(0);
                setOpen(null);
                setOpenBank(null);
                setEditing(null);
              }}
              onChanged={loadCatalog}
              run={run}
            />
          )}
          {tab === "review" && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <p className="px-4 py-3 text-xs text-gray-500 border-b border-gray-100">
                Questions waiting for someone more experienced than their author. Open one to validate it or send it back with what to fix.
              </p>
              <QuestionRows questions={reviews} onOpen={openQuestion} showSkill />
            </div>
          )}
          {tab === "mine" && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <QuestionRows questions={mine} onOpen={openQuestion} showSkill />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {tab === "skills" && skill && !open && !openBank && !editing && (
            <SkillPanel
              skill={skill}
              level={level}
              setLevel={setLevel}
              questions={questions}
              shared={bankList}
              onOpen={openQuestion}
              onOpenShared={openShared}
              onNew={() => setEditing({ mode: "new", draft: emptyDraft(skill.id, level || 2) })}
            />
          )}
          {openBank && !editing && (
            <SharedView q={openBank} skill={skill?.name ?? ""} busy={busy} onClose={() => setOpenBank(null)} onCopy={copyShared} />
          )}
          {tab === "skills" && !skill && !open && !openBank && !editing && (
            <p className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
              Pick a skill to see its questions, or create a domain and its skills.
            </p>
          )}
          {editing && (
            <QuestionEditor
              editing={editing}
              skills={skills}
              busy={busy}
              onChange={(draft) => setEditing({ ...editing, draft })}
              onSave={saveQuestion}
              onCancel={() => setEditing(null)}
            />
          )}
          {open && !editing && (
            <QuestionView
              q={open}
              busy={busy}
              canCurate={Boolean(me?.can_curate)}
              onClose={() => setOpen(null)}
              onEdit={() => setEditing({ mode: "edit", id: open.id, draft: draftOf(open) })}
              onCorrect={() => setEditing({ mode: "correct", id: open.id, draft: draftOf(open) })}
              onSubmit={() => act("submit")}
              onReview={(decision, comment) => act("review", { decision, comment })}
              onRetire={() => act("retire")}
              onDelete={remove}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Catalog({
  domains,
  me,
  skillId,
  onPick,
  onChanged,
  run,
}: {
  domains: Domain[];
  me: LibraryMe | null;
  skillId: string;
  onPick: (id: string) => void;
  onChanged: () => Promise<void>;
  run: <T>(action: () => Promise<T>, fallback: string) => Promise<T | null>;
}) {
  const [domainName, setDomainName] = useState("");
  const [adding, setAdding] = useState<Record<string, string>>({});
  const curate = Boolean(me?.can_curate);

  async function addDomain(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api("/api/questions/domains", { method: "POST", body: JSON.stringify({ name: domainName }) }), "Could not add the domain");
    if (ok) {
      setDomainName("");
      await onChanged();
    }
  }

  async function addSkill(e: FormEvent, domainId: string) {
    e.preventDefault();
    const s = await run(
      () => api<LibrarySkill>("/api/questions/skills", { method: "POST", body: JSON.stringify({ domain_id: domainId, name: adding[domainId] }) }),
      "Could not add the skill",
    );
    if (s) {
      setAdding({ ...adding, [domainId]: "" });
      await onChanged();
      onPick(s.id);
    }
  }

  async function removeDomain(d: Domain) {
    if (!confirm(`Delete the domain ${d.name}?`)) return;
    if ((await run(() => api(`/api/questions/domains/${d.id}`, { method: "DELETE" }), "Could not delete the domain")) !== null) await onChanged();
  }

  async function removeSkill(s: LibrarySkill) {
    if (!confirm(`Delete the skill ${s.name}?`)) return;
    if ((await run(() => api(`/api/questions/skills/${s.id}`, { method: "DELETE" }), "Could not delete the skill")) !== null) await onChanged();
  }

  return (
    <div className="space-y-4">
      {domains.map((d) => (
        <section key={d.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <h2 className="font-semibold text-gray-800 flex-1">{d.name}</h2>
            {d.builtin ? (
              <span className="text-xs text-gray-400">Suggested</span>
            ) : (
              curate &&
              d.skills.length === 0 && (
                <button onClick={() => removeDomain(d)} className="text-xs text-red-500 hover:underline">
                  Delete
                </button>
              )
            )}
          </div>
          <ul className="p-2">
            {d.skills.map((s) => {
              const approved = s.library.reduce((n, l) => n + l.approved, 0);
              const pending = s.library.reduce((n, l) => n + l.pending, 0);
              return (
                <li key={s.id} className="flex items-center">
                  <button
                    onClick={() => onPick(s.id)}
                    className={`flex-1 text-left rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${s.id === skillId ? "bg-blue-50 text-blue-800" : "hover:bg-gray-50 text-gray-700"}`}
                  >
                    <span className="flex-1">{s.name}</span>
                    {s.builtin && (
                      <span className="text-xs text-blue-700 tabular-nums">{s.library.reduce((n, l) => n + l.shared, 0)} shared</span>
                    )}
                    <span className="text-xs text-gray-500 tabular-nums">{approved} yours</span>
                    {pending > 0 && <span className="text-xs text-amber-700 tabular-nums">{pending} to validate</span>}
                  </button>
                  {curate && s.own && approved + pending === 0 && (
                    <button onClick={() => removeSkill(s)} className="text-xs text-gray-400 hover:text-red-500 px-2" aria-label={`Delete ${s.name}`}>
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {curate && (
            <form onSubmit={(e) => addSkill(e, d.id)} className="px-4 pb-3 flex gap-2">
              <input
                placeholder="New skill, e.g. Excel"
                value={adding[d.id] ?? ""}
                onChange={(e) => setAdding({ ...adding, [d.id]: e.target.value })}
                className={`${small} flex-1 min-w-0`}
                maxLength={60}
              />
              <button disabled={!(adding[d.id] ?? "").trim()} className="text-sm text-blue-600 hover:underline disabled:opacity-40">
                Add skill
              </button>
            </form>
          )}
        </section>
      ))}
      {curate ? (
        <form onSubmit={addDomain} className="bg-white rounded-xl border border-dashed border-gray-300 p-4 flex gap-2">
          <input
            placeholder="New domain, e.g. Finance or Accounting"
            value={domainName}
            onChange={(e) => setDomainName(e.target.value)}
            className={`${small} flex-1 min-w-0`}
            maxLength={80}
          />
          <button disabled={!domainName.trim()} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
            Add domain
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-400">Admins and editors create domains and skills.</p>
      )}
    </div>
  );
}

function SkillPanel({
  skill,
  level,
  setLevel,
  questions,
  shared,
  onOpen,
  onOpenShared,
  onNew,
}: {
  skill: LibrarySkill;
  level: number;
  setLevel: (n: number) => void;
  questions: LibraryQuestionSummary[];
  shared: BankQuestion[];
  onOpen: (id: string) => void;
  onOpenShared: (id: string) => void;
  onNew: () => void;
}) {
  const count = (lv: number) => skill.library.find((l) => l.level === lv);
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <div className="flex-1">
          <h2 className="font-semibold text-gray-800">{skill.name}</h2>
          <p className="text-xs text-gray-500">
            {skill.builtin
              ? "Tests also draw this skill's code and QCM questions from the shared bank; your questions come on top."
              : "Your company's own skill: tests draw only from your questions."}
          </p>
        </div>
        <button onClick={onNew} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700">
          New question
        </button>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-gray-100">
        <button onClick={() => setLevel(0)} className={`text-xs px-2.5 py-1 rounded-full border ${level === 0 ? "bg-gray-800 text-white border-gray-800" : "border-gray-300 text-gray-600"}`}>
          All levels
        </button>
        {[1, 2, 3, 4, 5].map((lv) => {
          const c = count(lv);
          return (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`text-xs px-2.5 py-1 rounded-full border ${level === lv ? "bg-gray-800 text-white border-gray-800" : "border-gray-300 text-gray-600"}`}
            >
              {lv} · {levelLabel[lv]} <span className="tabular-nums opacity-70">({(c?.approved ?? 0) + (c?.shared ?? 0)})</span>
            </button>
          );
        })}
      </div>
      {skill.builtin && <p className="px-4 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Your company&apos;s questions</p>}
      <QuestionRows questions={questions} onOpen={onOpen} />
      {skill.builtin && (
        <>
          <p className="px-4 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-100">
            Shared bank · {shared.length}
          </p>
          {shared.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No shared questions at this level.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {shared.map((q) => (
                <li key={q.id}>
                  <button onClick={() => onOpenShared(q.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{q.title}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Level {q.level} · {q.kind === "code" ? "Code" : "QCM"}
                      </span>
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 whitespace-nowrap">Shared</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SharedView({
  q,
  skill,
  busy,
  onClose,
  onCopy,
}: {
  q: BankQuestionDetail;
  skill: string;
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">
            {skill} · Level {q.level} · {levelLabel[q.level]} · {q.kind === "code" ? "Code" : "Multiple choice"} ·{" "}
            {Math.round(q.timer_seconds / 60) || 1} min
          </p>
          <h2 className="font-semibold text-gray-900 mt-1">{q.title}</h2>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">Shared</span>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-xs text-blue-700 bg-blue-50 rounded px-3 py-2">
        From the shared bank every company&apos;s tests draw from. It is read-only here
        {q.kind === "qcm" ? ": copy it into your library to adapt it." : "."}
      </p>
      <div className="text-sm text-gray-800 whitespace-pre-wrap">{q.statement}</div>
      {q.kind === "qcm" ? (
        <ul className="space-y-1.5">
          {q.choices?.map((c, i) => (
            <li
              key={i}
              className={`text-sm rounded px-3 py-1.5 border whitespace-pre-wrap ${q.correct_choices?.includes(i) ? "border-green-300 bg-green-50" : "border-gray-100"}`}
            >
              {c}
              {q.correct_choices?.includes(i) && <span className="text-xs text-green-700 ml-2">right</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {q.starter_code && <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto">{q.starter_code}</pre>}
          {q.examples.map((x, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-gray-500">{x.name} · input</p>
                <pre className="bg-gray-50 rounded p-2 overflow-x-auto">{x.input || "(empty)"}</pre>
              </div>
              <div>
                <p className="text-gray-500">expected output</p>
                <pre className="bg-gray-50 rounded p-2 overflow-x-auto">{x.expected_output || "(empty)"}</pre>
              </div>
            </div>
          ))}
          {q.hidden_tests > 0 && (
            <p className="text-xs text-gray-500">
              {q.hidden_tests} hidden test{q.hidden_tests > 1 ? "s" : ""} also check the code.
            </p>
          )}
        </div>
      )}
      {q.kind === "qcm" && (
        <div className="border-t border-gray-100 pt-4">
          <button onClick={onCopy} disabled={busy} className="text-sm text-blue-600 hover:underline disabled:opacity-50">
            Copy to my library as a draft
          </button>
        </div>
      )}
    </section>
  );
}

function QuestionEditor({
  editing,
  skills,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing;
  skills: LibrarySkill[];
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: (submit: boolean) => void;
  onCancel: () => void;
}) {
  const d = editing.draft;
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const heading = editing.mode === "new" ? "New question" : editing.mode === "edit" ? "Edit the question" : "Propose a correction";
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">{heading}</h2>
          {editing.mode === "correct" && (
            <p className="text-xs text-gray-500 mt-0.5">The current version stays in tests until a more experienced colleague validates yours.</p>
          )}
        </div>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-700">
          Skill
          <select value={d.skill_id} onChange={(e) => set({ skill_id: e.target.value })} className={`${field} mt-1`}>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Level (the experience it tests)
          <select value={d.level} onChange={(e) => set({ level: Number(e.target.value) })} className={`${field} mt-1`}>
            {[1, 2, 3, 4, 5].map((lv) => (
              <option key={lv} value={lv}>
                {lv} · {levelLabel[lv]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        {(
          [
            ["qcm", "Multiple choice"],
            ["numeric", "Number answer"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ kind: k })}
            className={`text-sm px-3 py-1.5 rounded-lg border ${d.kind === k ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-300 text-gray-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="block text-sm text-gray-700">
        Title
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} className={`${field} mt-1`} placeholder="e.g. Net present value of a project" />
      </label>
      <label className="block text-sm text-gray-700">
        Question
        <textarea value={d.statement} onChange={(e) => set({ statement: e.target.value })} rows={5} className={`${field} mt-1 resize-y`} placeholder="What the candidate reads, with every figure they need." />
      </label>
      {d.kind === "qcm" ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-700">Options: tick every right one</p>
          {d.choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.correct_choices.includes(i)}
                onChange={() =>
                  set({ correct_choices: d.correct_choices.includes(i) ? d.correct_choices.filter((x) => x !== i) : [...d.correct_choices, i].sort() })
                }
                aria-label={`Option ${i + 1} is right`}
              />
              <input
                value={c}
                onChange={(e) => set({ choices: d.choices.map((x, j) => (j === i ? e.target.value : x)) })}
                className={`${small} flex-1`}
                placeholder={`Option ${i + 1}`}
              />
              {d.choices.length > 2 && (
                <button
                  type="button"
                  onClick={() =>
                    set({
                      choices: d.choices.filter((_, j) => j !== i),
                      correct_choices: d.correct_choices.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)),
                    })
                  }
                  className="text-gray-400 hover:text-red-500 text-sm px-1"
                  aria-label={`Remove option ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {d.choices.length < 10 && (
            <button type="button" onClick={() => set({ choices: [...d.choices, ""] })} className="text-sm text-blue-600 hover:underline">
              Add an option
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm text-gray-700">
            Right answer
            <input inputMode="decimal" value={d.answer_value} onChange={(e) => set({ answer_value: e.target.value })} className={`${field} mt-1`} placeholder="1250.5" />
          </label>
          <label className="text-sm text-gray-700">
            Accepted ±
            <input inputMode="decimal" value={d.tolerance} onChange={(e) => set({ tolerance: e.target.value })} className={`${field} mt-1`} placeholder="0.5" />
          </label>
          <label className="text-sm text-gray-700">
            Unit
            <input value={d.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={20} className={`${field} mt-1`} placeholder="EUR, %" />
          </label>
        </div>
      )}
      <label className="block text-sm text-gray-700">
        Why it is right (for reviewers and recruiters, never shown to candidates)
        <textarea value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} rows={3} className={`${field} mt-1 resize-y`} />
      </label>
      <label className="block text-sm text-gray-700 w-40">
        Time (seconds)
        <input type="number" min={15} max={3600} value={d.timer_seconds} onChange={(e) => set({ timer_seconds: Number(e.target.value) })} className={`${field} mt-1`} />
      </label>
      <div className="flex flex-wrap gap-3 pt-2">
        <button onClick={() => onSave(true)} disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          Send for validation
        </button>
        <button onClick={() => onSave(false)} disabled={busy} className="border border-gray-300 px-4 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Save as draft
        </button>
      </div>
    </section>
  );
}

function QuestionView({
  q,
  busy,
  canCurate,
  onClose,
  onEdit,
  onCorrect,
  onSubmit,
  onReview,
  onRetire,
  onDelete,
}: {
  q: LibraryQuestion;
  busy: boolean;
  canCurate: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCorrect: () => void;
  onSubmit: () => void;
  onReview: (decision: "approve" | "reject", comment: string) => void;
  onRetire: () => void;
  onDelete: () => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">
            {q.domain} › {q.skill} · Level {q.level} · {levelLabel[q.level]} · {q.kind === "qcm" ? "Multiple choice" : "Number answer"} · {Math.round(q.timer_seconds / 60) || 1} min
          </p>
          <h2 className="font-semibold text-gray-900 mt-1">{q.title}</h2>
        </div>
        <Status status={q.status} />
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800" aria-label="Close">
          ✕
        </button>
      </div>
      {q.replaces_id && <p className="text-xs text-blue-700 bg-blue-50 rounded px-3 py-2">A correction of a validated question: it replaces it once validated.</p>}
      <div className="text-sm text-gray-800 whitespace-pre-wrap">{q.statement}</div>
      {q.kind === "qcm" ? (
        <ul className="space-y-1.5">
          {q.choices?.map((c, i) => (
            <li
              key={i}
              className={`text-sm rounded px-3 py-1.5 border ${q.correct_choices?.includes(i) ? "border-green-300 bg-green-50" : "border-gray-100"}`}
            >
              {c}
              {q.correct_choices?.includes(i) && <span className="text-xs text-green-700 ml-2">right</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          Right answer: <strong className="tabular-nums">{q.answer_value}</strong> {q.unit}
          {q.tolerance ? <span className="text-gray-500"> (± {q.tolerance})</span> : null}
        </p>
      )}
      {q.explanation && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded px-3 py-2 whitespace-pre-wrap">
          <span className="font-medium">Why: </span>
          {q.explanation}
        </div>
      )}
      <p className="text-xs text-gray-500">
        Written by {q.author.name}
        {q.author.experience ? ` (${experienceLabel[q.author.experience]})` : ""}
        {q.reviewer && ` · ${q.status === "rejected" ? "sent back" : "validated"} by ${q.reviewer.name}`}
        {q.status === "approved" || q.status === "retired" ? ` · in ${q.used_count} test${q.used_count === 1 ? "" : "s"}` : ""}
      </p>
      {q.review_comment && (
        <p className={`text-sm rounded px-3 py-2 ${q.status === "rejected" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-700"}`}>
          <span className="font-medium">Reviewer: </span>
          {q.review_comment}
        </p>
      )}

      {q.can_review && (
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <p className="text-sm font-medium text-gray-800">Your review</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className={`${field} resize-y`}
            placeholder="What to fix (needed to send it back), or a note"
          />
          <div className="flex gap-3">
            <button
              onClick={() => onReview("approve", comment)}
              disabled={busy}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
            >
              Validate
            </button>
            <button
              onClick={() => onReview("reject", comment)}
              disabled={busy || !comment.trim()}
              className="border border-red-300 text-red-600 px-4 py-2 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40"
            >
              Send back to fix
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4 text-sm empty:hidden">
        {q.can_edit && (
          <button onClick={onEdit} className="text-blue-600 hover:underline">
            Edit
          </button>
        )}
        {q.can_edit && q.status !== "pending" && (
          <button onClick={onSubmit} disabled={busy} className="text-blue-600 hover:underline">
            Send for validation
          </button>
        )}
        {q.status === "approved" && (
          <button onClick={onCorrect} className="text-blue-600 hover:underline">
            Propose a correction
          </button>
        )}
        {q.status === "approved" && canCurate && (
          <button onClick={onRetire} disabled={busy} className="text-gray-500 hover:underline">
            Take out of tests
          </button>
        )}
        {q.can_edit && (
          <button onClick={onDelete} disabled={busy} className="text-red-500 hover:underline ml-auto">
            Delete
          </button>
        )}
        {q.status === "pending" && !q.can_review && !q.can_edit && (
          <span className="text-gray-400">Waiting for someone more experienced than its author.</span>
        )}
      </div>
    </section>
  );
}
