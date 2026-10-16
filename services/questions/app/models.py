"""Tables owned by the questions service: the test library.

A domain (Dev / Data / Technique, Finance, Accounting...) groups skills. Each
skill has a library of questions per level (1 beginner to 5 master).

Built-in domains and skills have no tenant: every company sees them. The
built-in skills are the languages and topics of Code Playground, whose code
and QCM questions every company shares. Companies add their own domains and
skills, and their own questions to any skill, built-in ones included.

A company's questions go through review: an employee writes one (draft),
submits it (pending), and a more experienced colleague, or an admin,
approves or rejects it. Only approved questions go into tests. An approved
question never changes: a correction is a new question that replaces it once
approved, so tests already sent keep the version their candidate saw.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rh_common.db import Base

KINDS = ("qcm", "numeric")
STATUSES = ("draft", "pending", "approved", "rejected", "retired")


class Domain(Base):
    __tablename__ = "domains"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # None: built in, shared by every company.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    skills: Mapped[list["Skill"]] = relationship(back_populates="domain", order_by="Skill.name", lazy="selectin")


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True, nullable=True)
    domain_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("domains.id", ondelete="RESTRICT"), index=True)
    # What offers and recipes name the skill by. Built-in skills use Code Playground's topic (python, sql...).
    key: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    domain: Mapped[Domain] = relationship(back_populates="skills", lazy="joined")


class Question(Base):
    """A company's question. kind "qcm": choose the right options; "numeric": give a number, within a tolerance."""

    __tablename__ = "library_questions"
    __table_args__ = (
        CheckConstraint("level BETWEEN 1 AND 5", name="ck_library_questions_level"),
        CheckConstraint("kind IN ('qcm', 'numeric')", name="ck_library_questions_kind"),
        CheckConstraint(
            "status IN ('draft', 'pending', 'approved', 'rejected', 'retired')", name="ck_library_questions_status"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    skill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skills.id", ondelete="RESTRICT"), index=True)
    level: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    statement: Mapped[str] = mapped_column(Text, default="")
    choices: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    correct_choices: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    answer_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Answers within answer_value ± tolerance are right.
    tolerance: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # For reviewers and recruiters: why the answer is right. Never shown to candidates.
    explanation: Mapped[str] = mapped_column(Text, default="")
    timer_seconds: Mapped[int] = mapped_column(Integer, default=120)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    # A correction: the approved question this one replaces once approved.
    replaces_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("library_questions.id"), nullable=True)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How many tests drew it: new tests prefer the least used.
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    skill: Mapped[Skill] = relationship(lazy="joined")
