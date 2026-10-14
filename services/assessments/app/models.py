"""Tables owned by the assessments service."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rh_common.db import Base


class TestSession(Base):
    """One candidate's test for one offer: its frozen questions, answers and scores."""

    __test__ = False  # not a pytest class

    __tablename__ = "test_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('invited', 'in_progress', 'submitted', 'scored', 'expired')", name="ck_test_sessions_status"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    offer_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    # One test per application.
    candidate_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    candidate_name: Mapped[str] = mapped_column(String(200))
    candidate_email: Mapped[str] = mapped_column(String(255))
    offer_title: Mapped[str] = mapped_column(String(255))
    codeplay_test_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(20), default="invited")
    # Seconds the candidate gets once they start: the sum of the questions' timers.
    duration_seconds: Mapped[int] = mapped_column(Integer)
    weight_theory: Mapped[float] = mapped_column(Float)
    weight_practice: Mapped[float] = mapped_column(Float)
    invited_by: Mapped[uuid.UUID] = mapped_column(Uuid)
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    link_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Percentages, 0-100, once scored. None when the test had no question of that kind.
    theory_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    practice_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    answers: Mapped[list["Answer"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Answer.position", lazy="selectin"
    )


class Answer(Base):
    """The candidate's answer to one question of their test, and its score once judged."""

    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("session_id", "problem_id", name="uq_answers_session_problem"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("test_sessions.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))
    language: Mapped[str] = mapped_column(String(30))
    level: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    choices: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    source_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submission_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # 0.0-1.0 once judged.
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    session: Mapped[TestSession] = relationship(back_populates="answers")
