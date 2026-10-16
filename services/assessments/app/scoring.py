"""Ends tests and scores them.

Ending a test (the candidate submits, or their time runs out) only marks it
submitted and queues a score_session job: the worker sends each code answer
to Code Playground to be judged, checks the QCM and numeric answers, and
fills in the scores once every code answer has been judged.

Theory is the QCM and numeric questions, practice the code ones.
"""

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Answer, TestSession
from rh_common import internal, queue
from rh_common.codeplay import CodePlayground
from rh_common.library import Library, library

log = logging.getLogger(__name__)
# Answers saved up to this long after the deadline still count (network delays).
GRACE = timedelta(seconds=30)


def now() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime | None) -> datetime | None:
    """SQLite drops time zones; every stored time is UTC."""
    return dt.replace(tzinfo=UTC) if dt is not None and dt.tzinfo is None else dt


def deadline(session: TestSession) -> datetime | None:
    started = aware(session.started_at)
    return started + timedelta(seconds=session.duration_seconds) if started else None


def end(db: Session, session: TestSession) -> None:
    """Stops the test and queues its scoring. Does nothing if it already ended."""
    if session.status != "in_progress":
        return
    session.status, session.submitted_at = "submitted", now()
    db.commit()
    queue.enqueue("assessments", "score_session", session_id=str(session.id))
    queue.enqueue(
        "notifications",
        "send_email",
        template="test_confirmation",
        to=session.candidate_email,
        tenant_id=str(session.tenant_id),
        data={"name": session.candidate_name, "offer_title": session.offer_title},
    )
    try:
        internal.call("POST", "candidates", f"/internal/candidates/{session.candidate_id}/status", json={"status": "tested"})
    except Exception:
        log.exception("could not mark candidate %s as tested", session.candidate_id)


def catch_up(db: Session, session: TestSession) -> None:
    """Applies what time changed since the last request: an unused link expires, an overdue test ends."""
    if session.status == "invited" and now() > aware(session.link_expires_at):
        session.status = "expired"
        db.commit()
    elif session.status == "in_progress" and now() > deadline(session) + GRACE:
        end(db, session)


def totals(session: TestSession) -> None:
    def percent(*kinds: str) -> float | None:
        scores = [a.score or 0.0 for a in session.answers if a.kind in kinds]
        return round(100 * sum(scores) / len(scores), 1) if scores else None

    session.theory_score, session.practice_score = percent("qcm", "numeric"), percent("code")
    if session.theory_score is None or session.practice_score is None:
        session.total_score = session.practice_score if session.theory_score is None else session.theory_score
    else:
        session.total_score = round(
            session.weight_theory * session.theory_score + session.weight_practice * session.practice_score, 1
        )


def judge_answer(bank: CodePlayground, session: TestSession, answer: Answer, lib: Library | None = None) -> bool:
    """Scores one answer as far as possible now; True once it has its final score."""
    if answer.score is not None:
        return True

    def full() -> dict:
        if answer.source == "library":
            return (lib or library()).questions([answer.problem_id])[str(answer.problem_id)]
        return bank.problem_full(str(answer.problem_id))

    if answer.kind == "numeric":
        q = full()
        if answer.value is None:
            answer.score, answer.verdict = 0.0, "no_answer"
        else:
            right = abs(answer.value - q["answer_value"]) <= (q.get("tolerance") or 0) + 1e-9
            answer.score, answer.verdict = (1.0, "correct") if right else (0.0, "wrong")
        return True
    if answer.kind == "qcm":
        right = full().get("correct_choices") or []
        given = answer.choices or []
        answer.score = 1.0 if given and sorted(set(given)) == sorted(right) else 0.0
        answer.verdict = "correct" if answer.score else ("no_answer" if not given else "wrong")
        return True
    if not (answer.source_code or "").strip():
        answer.score, answer.verdict = 0.0, "no_answer"
        return True
    if answer.submission_id is None:
        sub = bank.create_submission(str(answer.problem_id), answer.language, answer.source_code, str(session.id))
        answer.submission_id = uuid.UUID(sub["id"])
    result = bank.submission(str(answer.submission_id))
    if result["status"] not in ("completed", "failed"):
        return False
    if result["status"] == "failed":
        # A platform error, not the candidate's fault: judge it again.
        answer.submission_id = None
        return False
    answer.verdict = result["verdict"]
    answer.score = result["score"] / result["max_score"] if result["max_score"] else 0.0
    return True


def score_session(
    job: dict, db: Session, bank: CodePlayground, sleep=time.sleep, patience: float = 600, lib: Library | None = None
) -> TestSession | None:
    """Worker job: judges every answer of an ended test, then sets its scores."""
    session = db.get(TestSession, uuid.UUID(job["session_id"]))
    if session is None or session.status != "submitted":
        return session
    waited = 0.0
    while True:
        done = [judge_answer(bank, session, a, lib) for a in session.answers]
        db.commit()
        if all(done):
            break
        if waited >= patience:
            log.warning("session %s is still being judged; queued again", session.id)
            queue.enqueue("assessments", "score_session", session_id=str(session.id))
            return session
        sleep(2)
        waited += 2
    totals(session)
    session.status = "scored"
    db.commit()
    return session
