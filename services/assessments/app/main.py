import os
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Answer, TestSession
from app.scoring import aware, catch_up, deadline, end, now
from rh_common import ApiError, Principal, create_app, internal, queue, require_role
from rh_common.codeplay import CodePlayground, codeplay
from rh_common.db import get_session
from rh_common.library import Library, library

app = create_app("assessments")

Db = Annotated[Session, Depends(get_session)]
Bank = Annotated[CodePlayground, Depends(codeplay)]
Lib = Annotated[Library, Depends(library)]
Staff = Annotated[Principal, Depends(require_role("admin", "editor", "recruiter"))]
Writer = Annotated[Principal, Depends(require_role("admin", "recruiter"))]
Candidate = Annotated[Principal, Depends(require_role("candidate"))]
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost")
LINK_DAYS = 7
RUNS_PER_MINUTE = 20
MAX_SOURCE = 64 * 1024


# --- shapes -----------------------------------------------------------------


class InviteIn(BaseModel):
    candidate_id: uuid.UUID


class SessionSummary(BaseModel):
    id: uuid.UUID
    offer_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    status: str
    invited_at: datetime
    started_at: datetime | None
    submitted_at: datetime | None
    theory_score: float | None
    practice_score: float | None
    total_score: float | None


class AnswerDetail(BaseModel):
    problem_id: uuid.UUID
    position: int
    source: str = Field(description="codeplay, or library: the company's own questions")
    kind: str
    language: str
    level: int
    title: str
    statement: str
    options: list[str] | None = Field(description="QCM: the options shown")
    correct_choices: list[int] | None = Field(description="QCM: the right options")
    choices: list[int] | None = Field(description="QCM: what the candidate picked")
    source_code: str | None
    value: float | None = Field(default=None, description="Numeric: what the candidate answered")
    answer_value: float | None = Field(default=None, description="Numeric: the right answer")
    tolerance: float | None = None
    unit: str | None = None
    explanation: str = ""
    skill: str | None = Field(default=None, description="The skill's name, for the company's own questions")
    verdict: str | None
    score: float | None = Field(description="0 to 1 once judged")


class SessionDetail(SessionSummary):
    offer_title: str
    duration_seconds: int
    weight_theory: float
    weight_practice: float
    answers: list[AnswerDetail]


class Question(BaseModel):
    """A question as the candidate sees it: visible test cases only, no right answers."""

    id: uuid.UUID
    position: int
    kind: str
    language: str
    level: int
    title: str
    statement: str
    timer_seconds: int
    starter_code: str | None
    choices: list[str] | None
    multiple: bool
    unit: str | None = Field(default=None, description="Numeric: the unit of the answer")
    skill: str | None = Field(default=None, description="The skill's name, for the company's own questions")
    examples: list[dict]
    hidden_tests: int
    answer_choices: list[int] | None
    answer_source: str | None
    answer_value: float | None = Field(default=None, description="Numeric: the saved answer")


class MyTest(BaseModel):
    status: str
    candidate_name: str
    offer_title: str
    duration_seconds: int
    question_count: int
    code_count: int
    qcm_count: int
    numeric_count: int = 0
    deadline: datetime | None
    seconds_left: int | None
    questions: list[Question] = Field(description="Empty until the test starts and after it ends")


class AnswerIn(BaseModel):
    choices: list[int] | None = Field(default=None, max_length=10)
    source_code: str | None = Field(default=None, max_length=MAX_SOURCE)
    value: float | None = Field(default=None, description="The answer to a numeric question")


class RunIn(BaseModel):
    problem_id: uuid.UUID
    source_code: str = Field(max_length=MAX_SOURCE)
    stdin: str = Field(default="", max_length=1024 * 1024)


def summary(s: TestSession, model=SessionSummary, **extra):
    return model(
        id=s.id,
        offer_id=s.offer_id,
        candidate_id=s.candidate_id,
        candidate_name=s.candidate_name,
        candidate_email=s.candidate_email,
        status=s.status,
        invited_at=s.invited_at,
        started_at=s.started_at,
        submitted_at=s.submitted_at,
        theory_score=s.theory_score,
        practice_score=s.practice_score,
        total_score=s.total_score,
        **extra,
    )


def own_session(db: Session, user: Principal, session_id: uuid.UUID) -> TestSession:
    s = db.get(TestSession, session_id)
    if s is None or s.tenant_id != user.tenant_id:
        raise ApiError(404, "not_found", "Test not found")
    catch_up(db, s)
    return s


# --- recruiters -------------------------------------------------------------


@app.post("/sessions", response_model=SessionSummary, status_code=201, tags=["sessions"])
def invite(body: InviteIn, db: Db, user: Writer, bank: Bank, lib: Lib) -> SessionSummary:
    """Draws the candidate's questions from the offer's recipe and emails them a 7-day test link."""
    candidate = internal.call("GET", "candidates", f"/internal/candidates/{body.candidate_id}")
    if candidate["tenant_id"] != str(user.tenant_id):
        raise ApiError(404, "not_found", "Candidate not found")
    if db.scalar(select(TestSession.id).where(TestSession.candidate_id == body.candidate_id)):
        raise ApiError(409, "already_invited", "This candidate already has a test")
    offer = internal.call("GET", "offers", f"/internal/offers/{candidate['offer_id']}")
    if offer["status"] != "active":
        raise ApiError(409, "offer_closed", "The offer is not open, so its candidates cannot be tested")
    recipe = [
        {"language": r["language"], "level": r["level"], "code": r["code_count"], "qcm": r["qcm_count"]}
        for r in offer["recipe"]
        if r["code_count"] or r["qcm_count"]
    ]
    own = [
        {"language": r["language"], "level": r["level"], "count": r["library_count"]}
        for r in offer["recipe"]
        if r.get("library_count")
    ]
    if not recipe and not own:
        raise ApiError(409, "recipe_not_ready", "The offer's test has no questions")

    session_id = uuid.uuid4()
    drawn = lib.draw(user.tenant_id, own) if own else []
    test = bank.create_test(recipe, scope=str(user.tenant_id), external_ref=str(session_id)) if recipe else None
    # In the recipe's order: each skill's Code Playground questions, then the company's own.
    order = {r["language"]: i for i, r in enumerate(offer["recipe"])}
    questions = [("codeplay", q) for q in (test["questions"] if test else [])] + [("library", q) for q in drawn]
    questions.sort(key=lambda sq: order.get(sq[1]["language"], len(order)))
    session = TestSession(
        id=session_id,
        tenant_id=user.tenant_id,
        offer_id=uuid.UUID(offer["id"]),
        candidate_id=body.candidate_id,
        candidate_name=candidate["name"],
        candidate_email=candidate["email"],
        offer_title=offer["title"],
        codeplay_test_id=uuid.UUID(test["id"]) if test else None,
        duration_seconds=sum(q["timer_seconds"] for _, q in questions),
        weight_theory=offer["weight_theory"],
        weight_practice=offer["weight_practice"],
        invited_by=uuid.UUID(user.sub),
        invited_at=now(),
        link_expires_at=now() + timedelta(days=LINK_DAYS),
        answers=[
            Answer(
                problem_id=uuid.UUID(q["id"]),
                position=i,
                source=source,
                kind=q["kind"],
                language=q["language"],
                level=q["level"],
                title=q["title"],
            )
            for i, (source, q) in enumerate(questions)
        ],
    )
    token = internal.call(
        "POST",
        "auth",
        "/internal/candidate-token",
        json={"candidate_id": str(body.candidate_id), "tenant_id": str(user.tenant_id), "session_id": str(session_id)},
    )["token"]
    db.add(session)
    db.commit()
    # The token rides in the URL fragment, which browsers never send to a server or log.
    queue.enqueue(
        "notifications",
        "send_email",
        template="test_invite",
        to=session.candidate_email,
        tenant_id=str(session.tenant_id),
        data={"name": session.candidate_name, "offer_title": session.offer_title, "link": f"{PUBLIC_URL}/test#{token}"},
    )
    internal.call("POST", "candidates", f"/internal/candidates/{body.candidate_id}/status", json={"status": "invited"})
    return summary(session)


@app.get("/sessions", response_model=list[SessionSummary], tags=["sessions"])
def list_sessions(
    db: Db,
    user: Staff,
    offer_id: uuid.UUID | None = Query(default=None),
    status: Literal["invited", "in_progress", "submitted", "scored", "expired"] | None = Query(default=None),
) -> list[SessionSummary]:
    """This company's tests, best total score first, then the ones not scored yet (newest first)."""
    query = select(TestSession).where(TestSession.tenant_id == user.tenant_id)
    if offer_id is not None:
        query = query.where(TestSession.offer_id == offer_id)
    sessions = list(db.scalars(query))
    for s in sessions:
        catch_up(db, s)
    if status is not None:
        sessions = [s for s in sessions if s.status == status]
    sessions.sort(key=lambda s: (s.total_score is None, -(s.total_score or 0), -aware(s.invited_at).timestamp()))
    return [summary(s) for s in sessions]


@app.get("/sessions/{session_id}", response_model=SessionDetail, tags=["sessions"])
def read_session(session_id: uuid.UUID, db: Db, user: Staff, bank: Bank, lib: Lib) -> SessionDetail:
    """One test with every question, the candidate's answers and how each was judged."""
    s = own_session(db, user, session_id)
    own = lib.questions([a.problem_id for a in s.answers if a.source == "library"])
    answers = []
    for a in s.answers:
        full = own[str(a.problem_id)] if a.source == "library" else bank.problem_full(str(a.problem_id))
        answers.append(
            AnswerDetail(
                problem_id=a.problem_id,
                position=a.position,
                source=a.source,
                kind=a.kind,
                language=a.language,
                level=a.level,
                title=a.title,
                statement=full["statement"],
                options=full.get("choices"),
                correct_choices=full.get("correct_choices"),
                choices=a.choices,
                source_code=a.source_code,
                value=a.value,
                answer_value=full.get("answer_value"),
                tolerance=full.get("tolerance"),
                unit=full.get("unit"),
                explanation=full.get("explanation") or "",
                skill=full.get("skill"),
                verdict=a.verdict,
                score=a.score,
            )
        )
    return summary(
        s,
        SessionDetail,
        offer_title=s.offer_title,
        duration_seconds=s.duration_seconds,
        weight_theory=s.weight_theory,
        weight_practice=s.weight_practice,
        answers=answers,
    )


# --- the candidate ----------------------------------------------------------
# A candidate's token opens their one test: role "candidate" with its session_id.


def my_session(db: Session, me: Principal) -> TestSession:
    s = db.get(TestSession, me.session_id) if me.session_id else None
    if s is None or str(s.candidate_id) != me.sub:
        raise ApiError(404, "not_found", "Test not found")
    catch_up(db, s)
    return s


def running(db: Session, me: Principal) -> TestSession:
    s = my_session(db, me)
    if s.status != "in_progress":
        raise ApiError(409, "test_not_running", "This test is not in progress")
    return s


def my_test(s: TestSession, bank: CodePlayground, lib: Library) -> MyTest:
    end_at = deadline(s)
    questions = []
    if s.status == "in_progress":
        shown = {q["id"]: q for q in bank.test(str(s.codeplay_test_id))["questions"]} if s.codeplay_test_id else {}
        shown |= lib.questions([a.problem_id for a in s.answers if a.source == "library"])
        for a in s.answers:
            q = shown[str(a.problem_id)]
            questions.append(
                Question(
                    id=q["id"],
                    position=a.position,
                    kind=q["kind"],
                    language=q["language"],
                    level=q["level"],
                    title=q["title"],
                    statement=q["statement"],
                    timer_seconds=q["timer_seconds"],
                    starter_code=q.get("starter_code"),
                    choices=q.get("choices"),
                    multiple=q.get("multiple", False),
                    unit=q.get("unit"),
                    skill=q.get("skill"),
                    examples=[
                        {"name": x["name"], "input": x["input"], "expected_output": x["expected_output"]}
                        for x in q.get("scenarios", [])
                    ],
                    hidden_tests=q.get("hidden_scenarios", 0),
                    answer_choices=a.choices,
                    answer_source=a.source_code,
                    answer_value=a.value,
                )
            )
    return MyTest(
        status=s.status,
        candidate_name=s.candidate_name,
        offer_title=s.offer_title,
        duration_seconds=s.duration_seconds,
        question_count=len(s.answers),
        code_count=sum(a.kind == "code" for a in s.answers),
        qcm_count=sum(a.kind == "qcm" for a in s.answers),
        numeric_count=sum(a.kind == "numeric" for a in s.answers),
        deadline=end_at,
        seconds_left=max(0, int((end_at - now()).total_seconds())) if end_at and s.status == "in_progress" else None,
        questions=questions,
    )


@app.get("/me", response_model=MyTest, tags=["candidate"])
def read_my_test(db: Db, me: Candidate, bank: Bank, lib: Lib) -> MyTest:
    """The candidate's test: an overview before they start, the questions while it runs."""
    return my_test(my_session(db, me), bank, lib)


@app.post("/me/start", response_model=MyTest, tags=["candidate"])
def start(db: Db, me: Candidate, bank: Bank, lib: Lib) -> MyTest:
    """Starts the clock. The candidate then has duration_seconds to answer and submit."""
    s = my_session(db, me)
    if s.status == "expired":
        raise ApiError(410, "link_expired", "This test link has expired")
    if s.status == "invited":
        s.status, s.started_at = "in_progress", now()
        db.commit()
    return my_test(s, bank, lib)


@app.put("/me/answers/{problem_id}", status_code=204, tags=["candidate"])
def save_answer(problem_id: uuid.UUID, body: AnswerIn, db: Db, me: Candidate) -> None:
    """Saves the answer to one question; saving again replaces it."""
    s = running(db, me)
    answer = next((a for a in s.answers if a.problem_id == problem_id), None)
    if answer is None:
        raise ApiError(404, "not_found", "This question is not part of your test")
    if answer.kind == "qcm":
        if body.choices is None or body.source_code is not None or body.value is not None:
            raise ApiError(400, "invalid_request", "A QCM answer is a list of choices")
        answer.choices = sorted(set(body.choices))
    elif answer.kind == "numeric":
        if body.choices is not None or body.source_code is not None:
            raise ApiError(400, "invalid_request", "A numeric answer is a number")
        answer.value = body.value
    else:
        if body.source_code is None or body.choices is not None or body.value is not None:
            raise ApiError(400, "invalid_request", "A code answer is source code")
        answer.source_code = body.source_code
    answer.answered_at = now()
    db.commit()


@app.post("/me/runs", status_code=202, tags=["candidate"])
def run_code(body: RunIn, db: Db, me: Candidate, bank: Bank) -> dict:
    """Runs the candidate's code once with the given input, to try it before submitting."""
    s = running(db, me)
    answer = next((a for a in s.answers if a.problem_id == body.problem_id and a.kind == "code"), None)
    if answer is None:
        raise ApiError(404, "not_found", "This code question is not part of your test")
    if queue.over_limit(f"run:{s.id}", RUNS_PER_MINUTE, 60):
        raise ApiError(429, "rate_limited", "Too many runs; wait a few seconds")
    return bank.create_run(answer.language, body.source_code, body.stdin, str(s.id))


@app.get("/me/runs/{run_id}", tags=["candidate"])
def read_run(run_id: uuid.UUID, db: Db, me: Candidate, bank: Bank) -> dict:
    my_session(db, me)
    r = bank.run(str(run_id))
    keep = ("id", "status", "verdict", "stdout", "stderr", "compile_output", "time_ms", "memory_kb")
    return {k: r.get(k) for k in keep}


@app.post("/me/submit", response_model=MyTest, tags=["candidate"])
def submit(db: Db, me: Candidate, bank: Bank, lib: Lib) -> MyTest:
    """Ends the test. Saved answers are judged; unanswered questions score 0."""
    s = running(db, me)
    end(db, s)
    return my_test(s, bank, lib)

