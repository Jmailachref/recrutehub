import logging
import random
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Domain, Question, Skill
from rh_common import ApiError, Principal, create_app, internal, require_role
from rh_common.codeplay import CodePlayground, codeplay
from rh_common.db import get_session

app = create_app("questions")
log = logging.getLogger(__name__)

Db = Annotated[Session, Depends(get_session)]
Bank = Annotated[CodePlayground, Depends(codeplay)]
Staff = Annotated[Principal, Depends(require_role("admin", "editor", "recruiter"))]
# Who shapes the catalog: domains and skills.
Curator = Annotated[Principal, Depends(require_role("admin", "editor"))]
Service = Annotated[Principal, Depends(require_role("service"))]

# The built-in domain of Code Playground's languages and topics (seeded by migration 0001).
TECH_DOMAIN = uuid.UUID("00000000-0000-4000-8000-000000000001")
TECH_NAMES = {"python": "Python", "javascript": "JavaScript", "typescript": "TypeScript", "java": "Java", "cpp": "C++", "go": "Go", "sql": "SQL", "docker": "Docker"}
EXPERIENCE = {1: "Junior", 2: "Intermediate", 3: "Senior", 4: "Expert"}
EDITABLE = ("draft", "pending", "rejected")


class Directory:
    """Who the company's employees are: name, role and experience, from auth."""

    def profiles(self, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
        ids = list({i for i in ids if i})
        if not ids:
            return {}
        rows = internal.call("POST", "auth", "/internal/users/profiles", json={"ids": [str(i) for i in ids]})
        return {uuid.UUID(p["id"]): p for p in rows}


_directory = Directory()


def directory() -> Directory:
    """FastAPI dependency (override it in tests)."""
    return _directory


People = Annotated[Directory, Depends(directory)]


# --- shapes -----------------------------------------------------------------


class DomainIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)


class DomainUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)


class SkillIn(BaseModel):
    domain_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60, pattern=r"^[\w+#.][\w+#. /&'()-]*$")


class SkillUpdate(BaseModel):
    domain_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=60, pattern=r"^[\w+#.][\w+#. /&'()-]*$")


class LevelCount(BaseModel):
    level: int
    approved: int
    pending: int
    shared: int = Field(default=0, description="Built-in skills: Code Playground's approved code and QCM questions")


class SkillOut(BaseModel):
    id: uuid.UUID
    domain_id: uuid.UUID
    key: str = Field(description="What offers and test recipes name this skill by")
    name: str
    builtin: bool = Field(description="Shared by every company; Code Playground's code and QCM questions")
    own: bool = Field(description="Created by this company: it can rename, move or delete it")
    library: list[LevelCount] = Field(description="This company's questions per level")


class DomainOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    builtin: bool
    skills: list[SkillOut]


class QuestionIn(BaseModel):
    skill_id: uuid.UUID
    level: int = Field(ge=1, le=5, description="1 beginner .. 5 master: the experience it tests")
    kind: Literal["qcm", "numeric"]
    title: str = Field(min_length=1, max_length=200)
    statement: str = Field(default="", max_length=20_000)
    choices: list[Annotated[str, Field(min_length=1, max_length=1000)]] | None = Field(default=None, max_length=10)
    correct_choices: list[int] | None = Field(default=None, max_length=10)
    answer_value: float | None = None
    tolerance: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=20)
    explanation: str = Field(default="", max_length=20_000)
    timer_seconds: int = Field(default=120, ge=15, le=3600)
    submit: bool = Field(default=False, description="Send it for review now instead of keeping a draft")

    @model_validator(mode="after")
    def answer_fits_kind(self) -> "QuestionIn":
        if self.kind == "qcm":
            if not self.choices or len(self.choices) < 2:
                raise ValueError("a QCM has at least 2 choices")
            if not self.correct_choices or any(not 0 <= c < len(self.choices) for c in self.correct_choices):
                raise ValueError("a QCM has at least one right choice among its choices")
            self.correct_choices = sorted(set(self.correct_choices))
            self.answer_value = self.tolerance = self.unit = None
        else:
            if self.answer_value is None:
                raise ValueError("a numeric question has its answer_value")
            self.tolerance = self.tolerance or 0.0
            self.choices = self.correct_choices = None
        return self


class Person(BaseModel):
    id: uuid.UUID
    name: str
    experience: int | None


class QuestionSummary(BaseModel):
    id: uuid.UUID
    skill_id: uuid.UUID
    skill: str
    domain: str
    level: int
    kind: str
    title: str
    status: str
    author: Person
    replaces_id: uuid.UUID | None
    updated_at: datetime | None


class QuestionOut(QuestionSummary):
    statement: str
    choices: list[str] | None
    correct_choices: list[int] | None
    answer_value: float | None
    tolerance: float | None
    unit: str | None
    explanation: str
    timer_seconds: int
    reviewer: Person | None
    review_comment: str
    reviewed_at: datetime | None
    used_count: int
    can_edit: bool
    can_review: bool


class ReviewIn(BaseModel):
    decision: Literal["approve", "reject"]
    comment: str = Field(default="", max_length=5000)


class MeOut(BaseModel):
    id: uuid.UUID
    role: str
    experience: int
    experience_label: str
    can_curate: bool = Field(description="May create domains and skills")


class StockRow(BaseModel):
    language: str = Field(description="The skill's key")
    level: int
    count: int


class DrawRow(BaseModel):
    language: str
    level: int = Field(ge=1, le=5)
    count: int = Field(ge=1, le=100)


class DrawIn(BaseModel):
    tenant_id: uuid.UUID
    rows: list[DrawRow] = Field(max_length=50)


class FullQuestion(BaseModel):
    """A question with its answer: for other services only."""

    id: uuid.UUID
    language: str
    skill: str
    level: int
    kind: str
    title: str
    statement: str
    choices: list[str] | None
    correct_choices: list[int] | None
    multiple: bool
    answer_value: float | None
    tolerance: float | None
    unit: str | None
    explanation: str
    timer_seconds: int


# --- helpers ----------------------------------------------------------------


def now() -> datetime:
    return datetime.now(UTC)


def slug(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    plain = plain.replace("+", "p").replace("#", "sharp")
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:26] or "skill"


def visible(model, tenant_id: uuid.UUID):
    return or_(model.tenant_id.is_(None), model.tenant_id == tenant_id)


def bank_stock(bank: CodePlayground) -> list[dict]:
    """Code Playground's approved questions per topic and level. Best effort: empty when it is down."""
    try:
        return bank.stock()
    except ApiError as exc:
        log.warning("could not read Code Playground's stock: %s", exc.message)
        return []


def ensure_bank_skills(db: Session, stock: list[dict]) -> None:
    """Adds Code Playground's new languages or topics to the built-in domain."""
    topics = {s["language"] for s in stock}
    known = set(db.scalars(select(Skill.key).where(Skill.tenant_id.is_(None))))
    missing = sorted(topics - known)
    if missing and db.get(Domain, TECH_DOMAIN) is not None:
        for key in missing:
            db.add(Skill(tenant_id=None, domain_id=TECH_DOMAIN, key=key, name=TECH_NAMES.get(key, key.capitalize())))
        try:
            db.commit()
        except IntegrityError:  # another request added them first
            db.rollback()
        db.expire_all()


def own_domain(db: Session, user: Principal, domain_id: uuid.UUID, write: bool = False) -> Domain:
    d = db.get(Domain, domain_id)
    if d is None or d.tenant_id not in (None, user.tenant_id):
        raise ApiError(404, "not_found", "Domain not found")
    if write and d.tenant_id is None:
        raise ApiError(403, "builtin", "Built-in domains cannot be changed")
    return d


def own_skill(db: Session, user: Principal, skill_id: uuid.UUID, write: bool = False) -> Skill:
    s = db.get(Skill, skill_id)
    if s is None or s.tenant_id not in (None, user.tenant_id):
        raise ApiError(404, "not_found", "Skill not found")
    if write and s.tenant_id is None:
        raise ApiError(403, "builtin", "Built-in skills cannot be changed")
    return s


def own_question(db: Session, user: Principal, question_id: uuid.UUID) -> Question:
    q = db.get(Question, question_id)
    if q is None or q.tenant_id != user.tenant_id or (q.status == "draft" and str(q.author_id) != user.sub):
        raise ApiError(404, "not_found", "Question not found")
    return q


def name_taken(db: Session, model, tenant_id: uuid.UUID, name: str, but: uuid.UUID | None = None, **where) -> bool:
    query = select(model.id).where(visible(model, tenant_id), func.lower(model.name) == name.strip().lower())
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    if but is not None:
        query = query.where(model.id != but)
    return db.scalar(query) is not None


def may_review(reviewer: dict | None, author: dict | None, reviewer_id: str, author_id: uuid.UUID) -> bool:
    """An admin, their own questions included, or someone else more experienced than the author."""
    if reviewer is None:
        return False
    if reviewer["role"] == "admin":
        return True
    if reviewer_id == str(author_id):
        return False
    return author is not None and reviewer["experience"] > author["experience"]


def person(profiles: dict[uuid.UUID, dict], user_id: uuid.UUID | None) -> Person | None:
    if user_id is None:
        return None
    p = profiles.get(user_id)
    return Person(id=user_id, name=p["name"] if p else "Former employee", experience=p["experience"] if p else None)


def summary_fields(q: Question, profiles: dict) -> dict:
    return dict(
        id=q.id,
        skill_id=q.skill_id,
        skill=q.skill.name,
        domain=q.skill.domain.name,
        level=q.level,
        kind=q.kind,
        title=q.title,
        status=q.status,
        author=person(profiles, q.author_id),
        replaces_id=q.replaces_id,
        updated_at=q.updated_at,
    )


def question_out(q: Question, user: Principal, people: Directory) -> QuestionOut:
    me = uuid.UUID(user.sub)
    profiles = people.profiles([q.author_id, q.reviewer_id, me])
    return QuestionOut(
        **summary_fields(q, profiles),
        statement=q.statement,
        choices=q.choices,
        correct_choices=q.correct_choices,
        answer_value=q.answer_value,
        tolerance=q.tolerance,
        unit=q.unit,
        explanation=q.explanation,
        timer_seconds=q.timer_seconds,
        reviewer=person(profiles, q.reviewer_id),
        review_comment=q.review_comment,
        reviewed_at=q.reviewed_at,
        used_count=q.used_count,
        can_edit=q.status in EDITABLE and q.author_id == me,
        can_review=q.status == "pending" and may_review(profiles.get(me), profiles.get(q.author_id), user.sub, q.author_id),
    )


def write_fields(q: Question, body: QuestionIn) -> None:
    for field in ("skill_id", "level", "kind", "title", "statement", "choices", "correct_choices", "answer_value", "tolerance", "unit", "explanation", "timer_seconds"):
        setattr(q, field, getattr(body, field))


def full(q: Question) -> FullQuestion:
    return FullQuestion(
        id=q.id,
        language=q.skill.key,
        skill=q.skill.name,
        level=q.level,
        kind=q.kind,
        title=q.title,
        statement=q.statement,
        choices=q.choices,
        correct_choices=q.correct_choices,
        multiple=q.kind == "qcm" and len(q.correct_choices or []) > 1,
        answer_value=q.answer_value,
        tolerance=q.tolerance,
        unit=q.unit,
        explanation=q.explanation,
        timer_seconds=q.timer_seconds,
    )


# --- me and the catalog -----------------------------------------------------


@app.get("/me", response_model=MeOut, tags=["catalog"])
def me(user: Staff, people: People) -> MeOut:
    """The caller's experience: whose questions they may validate."""
    p = people.profiles([uuid.UUID(user.sub)]).get(uuid.UUID(user.sub))
    experience = p["experience"] if p else 1
    return MeOut(id=user.sub, role=user.role, experience=experience, experience_label=EXPERIENCE[experience], can_curate=user.role in ("admin", "editor"))


@app.get("/catalog", response_model=list[DomainOut], tags=["catalog"])
def catalog(db: Db, user: Staff, bank: Bank) -> list[DomainOut]:
    """Every domain this company sees, built-in ones first, with their skills and library counts."""
    stock = bank_stock(bank)
    ensure_bank_skills(db, stock)
    shared = {(s["language"], s["level"]): s["code"] + s["qcm"] for s in stock}
    counts: dict[tuple[uuid.UUID, int], dict[str, int]] = {}
    rows = db.execute(
        select(Question.skill_id, Question.level, Question.status, func.count())
        .where(Question.tenant_id == user.tenant_id, Question.status.in_(("approved", "pending")))
        .group_by(Question.skill_id, Question.level, Question.status)
    )
    for skill_id, level, status, n in rows:
        counts.setdefault((skill_id, level), {"approved": 0, "pending": 0})[status] = n
    domains = db.scalars(select(Domain).where(visible(Domain, user.tenant_id)).order_by(Domain.tenant_id.is_not(None), Domain.name))
    out = []
    for d in domains:
        skills = [s for s in d.skills if s.tenant_id in (None, user.tenant_id)]
        out.append(
            DomainOut(
                id=d.id,
                name=d.name,
                description=d.description,
                builtin=d.tenant_id is None,
                skills=[
                    SkillOut(
                        id=s.id,
                        domain_id=d.id,
                        key=s.key,
                        name=s.name,
                        builtin=s.tenant_id is None,
                        own=s.tenant_id is not None,
                        library=[
                            LevelCount(
                                level=lv,
                                **counts.get((s.id, lv), {"approved": 0, "pending": 0}),
                                shared=shared.get((s.key, lv), 0) if s.tenant_id is None else 0,
                            )
                            for lv in range(1, 6)
                            if (s.id, lv) in counts or (s.tenant_id is None and (s.key, lv) in shared)
                        ],
                    )
                    for s in skills
                ],
            )
        )
    return out


@app.post("/domains", response_model=DomainOut, status_code=201, tags=["catalog"])
def create_domain(body: DomainIn, db: Db, user: Curator) -> DomainOut:
    if name_taken(db, Domain, user.tenant_id, body.name):
        raise ApiError(409, "name_taken", "A domain already has this name")
    d = Domain(tenant_id=user.tenant_id, name=body.name.strip(), description=body.description)
    db.add(d)
    db.commit()
    return DomainOut(id=d.id, name=d.name, description=d.description, builtin=False, skills=[])


@app.patch("/domains/{domain_id}", response_model=DomainOut, tags=["catalog"])
def update_domain(domain_id: uuid.UUID, body: DomainUpdate, db: Db, user: Curator) -> DomainOut:
    d = own_domain(db, user, domain_id, write=True)
    if body.name is not None:
        if name_taken(db, Domain, user.tenant_id, body.name, but=d.id):
            raise ApiError(409, "name_taken", "A domain already has this name")
        d.name = body.name.strip()
    if body.description is not None:
        d.description = body.description
    db.commit()
    return DomainOut(id=d.id, name=d.name, description=d.description, builtin=False, skills=[])


@app.delete("/domains/{domain_id}", status_code=204, tags=["catalog"])
def delete_domain(domain_id: uuid.UUID, db: Db, user: Curator) -> None:
    """Deletes an empty domain: move or delete its skills first."""
    d = own_domain(db, user, domain_id, write=True)
    if db.scalar(select(Skill.id).where(Skill.domain_id == d.id).limit(1)):
        raise ApiError(409, "not_empty", "This domain still has skills")
    db.delete(d)
    db.commit()


@app.post("/skills", response_model=SkillOut, status_code=201, tags=["catalog"])
def create_skill(body: SkillIn, db: Db, user: Curator) -> SkillOut:
    """A skill of this company, in one of its domains or a built-in one."""
    d = own_domain(db, user, body.domain_id)
    if name_taken(db, Skill, user.tenant_id, body.name):
        raise ApiError(409, "name_taken", "A skill already has this name")
    keys = set(db.scalars(select(Skill.key).where(visible(Skill, user.tenant_id))))
    key, n = slug(body.name), 2
    base = key
    while key in keys:
        key, n = f"{base}-{n}", n + 1
    s = Skill(tenant_id=user.tenant_id, domain_id=d.id, key=key, name=body.name.strip())
    db.add(s)
    db.commit()
    return SkillOut(id=s.id, domain_id=d.id, key=s.key, name=s.name, builtin=False, own=True, library=[])


@app.patch("/skills/{skill_id}", response_model=SkillOut, tags=["catalog"])
def update_skill(skill_id: uuid.UUID, body: SkillUpdate, db: Db, user: Curator) -> SkillOut:
    """Renames or moves a skill. Its key stays, so offers that use it keep working."""
    s = own_skill(db, user, skill_id, write=True)
    if body.name is not None:
        if name_taken(db, Skill, user.tenant_id, body.name, but=s.id):
            raise ApiError(409, "name_taken", "A skill already has this name")
        s.name = body.name.strip()
    if body.domain_id is not None:
        s.domain_id = own_domain(db, user, body.domain_id).id
    db.commit()
    db.refresh(s)
    return SkillOut(id=s.id, domain_id=s.domain_id, key=s.key, name=s.name, builtin=False, own=True, library=[])


@app.delete("/skills/{skill_id}", status_code=204, tags=["catalog"])
def delete_skill(skill_id: uuid.UUID, db: Db, user: Curator) -> None:
    s = own_skill(db, user, skill_id, write=True)
    if db.scalar(select(Question.id).where(Question.skill_id == s.id).limit(1)):
        raise ApiError(409, "not_empty", "This skill has questions")
    db.delete(s)
    db.commit()


# --- questions --------------------------------------------------------------


@app.get("/questions", response_model=list[QuestionSummary], tags=["questions"])
def list_questions(
    db: Db,
    user: Staff,
    people: People,
    skill_id: uuid.UUID | None = Query(default=None),
    level: int | None = Query(default=None, ge=1, le=5),
    status: Literal["draft", "pending", "approved", "rejected", "retired"] | None = Query(default=None),
    mine: bool = Query(default=False, description="Only the caller's questions"),
) -> list[QuestionSummary]:
    """This company's questions, newest first. Drafts show to their author only."""
    query = select(Question).where(
        Question.tenant_id == user.tenant_id, or_(Question.status != "draft", Question.author_id == uuid.UUID(user.sub))
    )
    if skill_id is not None:
        query = query.where(Question.skill_id == skill_id)
    if level is not None:
        query = query.where(Question.level == level)
    if status is not None:
        query = query.where(Question.status == status)
    if mine:
        query = query.where(Question.author_id == uuid.UUID(user.sub))
    questions = list(db.scalars(query.order_by(Question.updated_at.desc(), Question.created_at.desc()).limit(500)))
    profiles = people.profiles([q.author_id for q in questions])
    return [QuestionSummary(**summary_fields(q, profiles)) for q in questions]


@app.get("/questions/{question_id}", response_model=QuestionOut, tags=["questions"])
def read_question(question_id: uuid.UUID, db: Db, user: Staff, people: People) -> QuestionOut:
    return question_out(own_question(db, user, question_id), user, people)


@app.post("/questions", response_model=QuestionOut, status_code=201, tags=["questions"])
def create_question(body: QuestionIn, db: Db, user: Staff, people: People) -> QuestionOut:
    """Writes a question: a draft, or with submit sent for review."""
    own_skill(db, user, body.skill_id)
    q = Question(tenant_id=user.tenant_id, author_id=uuid.UUID(user.sub), status="pending" if body.submit else "draft")
    write_fields(q, body)
    db.add(q)
    db.commit()
    db.refresh(q)
    return question_out(q, user, people)


@app.put("/questions/{question_id}", response_model=QuestionOut, tags=["questions"])
def update_question(question_id: uuid.UUID, body: QuestionIn, db: Db, user: Staff, people: People) -> QuestionOut:
    """The author rewrites their question while it is not approved. A rejected one goes back to draft, or for review with submit."""
    q = own_question(db, user, question_id)
    if str(q.author_id) != user.sub or q.status not in EDITABLE:
        raise ApiError(409, "not_editable", "Only its author can change a question, until it is approved: propose a correction instead")
    own_skill(db, user, body.skill_id)
    write_fields(q, body)
    if body.submit:
        q.status = "pending"
    elif q.status == "rejected":
        q.status = "draft"
    db.commit()
    db.refresh(q)
    return question_out(q, user, people)


@app.post("/questions/{question_id}/submit", response_model=QuestionOut, tags=["questions"])
def submit_question(question_id: uuid.UUID, db: Db, user: Staff, people: People) -> QuestionOut:
    q = own_question(db, user, question_id)
    if str(q.author_id) != user.sub or q.status not in ("draft", "rejected"):
        raise ApiError(409, "not_editable", "Only its author can send a draft for review")
    q.status = "pending"
    db.commit()
    return question_out(q, user, people)


@app.post("/questions/{question_id}/corrections", response_model=QuestionOut, status_code=201, tags=["questions"])
def correct_question(question_id: uuid.UUID, body: QuestionIn, db: Db, user: Staff, people: People) -> QuestionOut:
    """Proposes a corrected version of an approved question. It replaces the original once approved."""
    original = own_question(db, user, question_id)
    if original.status != "approved":
        raise ApiError(409, "not_approved", "Only approved questions take corrections: edit the question itself")
    own_skill(db, user, body.skill_id)
    q = Question(
        tenant_id=user.tenant_id,
        author_id=uuid.UUID(user.sub),
        replaces_id=original.id,
        status="pending" if body.submit else "draft",
    )
    write_fields(q, body)
    db.add(q)
    db.commit()
    db.refresh(q)
    return question_out(q, user, people)


@app.post("/questions/{question_id}/review", response_model=QuestionOut, tags=["questions"])
def review_question(question_id: uuid.UUID, body: ReviewIn, db: Db, user: Staff, people: People) -> QuestionOut:
    """Approves or rejects a pending question. The reviewer is an admin, or more experienced than its author."""
    q = own_question(db, user, question_id)
    if q.status != "pending":
        raise ApiError(409, "not_pending", "This question is not waiting for review")
    me = uuid.UUID(user.sub)
    profiles = people.profiles([me, q.author_id])
    if not may_review(profiles.get(me), profiles.get(q.author_id), user.sub, q.author_id):
        raise ApiError(403, "forbidden", "A question is validated by an admin, or by someone more experienced than its author")
    if body.decision == "reject" and not body.comment.strip():
        raise ApiError(400, "invalid_request", "Say what to fix when rejecting a question")
    q.status = "approved" if body.decision == "approve" else "rejected"
    q.reviewer_id, q.review_comment, q.reviewed_at = me, body.comment.strip(), now()
    if q.status == "approved" and q.replaces_id is not None:
        original = db.get(Question, q.replaces_id)
        if original is not None and original.status == "approved":
            original.status = "retired"
            q.used_count = original.used_count
    db.commit()
    return question_out(q, user, people)


@app.post("/questions/{question_id}/retire", response_model=QuestionOut, tags=["questions"])
def retire_question(question_id: uuid.UUID, db: Db, user: Curator, people: People) -> QuestionOut:
    """Takes an approved question out of new tests. Tests already sent keep it."""
    q = own_question(db, user, question_id)
    if q.status != "approved":
        raise ApiError(409, "not_approved", "Only approved questions can be retired")
    q.status = "retired"
    db.commit()
    return question_out(q, user, people)


@app.delete("/questions/{question_id}", status_code=204, tags=["questions"])
def delete_question(question_id: uuid.UUID, db: Db, user: Staff) -> None:
    """The author deletes a question that never went into a test (not approved)."""
    q = own_question(db, user, question_id)
    if str(q.author_id) != user.sub or q.status not in EDITABLE:
        raise ApiError(409, "not_editable", "Only its author can delete a question that is not approved")
    db.delete(q)
    db.commit()


@app.get("/reviews", response_model=list[QuestionSummary], tags=["questions"])
def review_queue(db: Db, user: Staff, people: People) -> list[QuestionSummary]:
    """Pending questions the caller may validate, oldest first."""
    me = uuid.UUID(user.sub)
    pending = list(
        db.scalars(
            select(Question)
            .where(Question.tenant_id == user.tenant_id, Question.status == "pending")
            .order_by(Question.updated_at, Question.created_at)
        )
    )
    profiles = people.profiles([me, *(q.author_id for q in pending)])
    return [
        QuestionSummary(**summary_fields(q, profiles))
        for q in pending
        if may_review(profiles.get(me), profiles.get(q.author_id), user.sub, q.author_id)
    ]


# --- the shared bank ------------------------------------------------------
# Code Playground's questions, which every company's tests draw for the built-in skills.
# Companies read them here and can copy a QCM into their own library to adapt it.


class BankQuestion(BaseModel):
    id: str
    title: str
    kind: str
    level: int


class BankQuestionOut(BankQuestion):
    statement: str
    choices: list[str] | None
    correct_choices: list[int] | None
    starter_code: str | None
    examples: list[dict] = Field(description="Code: the test cases candidates see")
    hidden_tests: int
    timer_seconds: int


class CopyIn(BaseModel):
    skill_id: uuid.UUID


def bank_skill(db: Session, user: Principal, skill_id: uuid.UUID) -> Skill:
    s = own_skill(db, user, skill_id)
    if s.tenant_id is not None:
        raise ApiError(404, "not_found", "Only built-in skills have shared questions")
    return s


def bank_question(bank: CodePlayground, s: Skill, question_id: str) -> dict:
    q = bank.problem_full(question_id)
    if q.get("language") != s.key or q.get("status") != "approved":
        raise ApiError(404, "not_found", "Question not found")
    return q


@app.get("/skills/{skill_id}/bank", response_model=list[BankQuestion], tags=["shared bank"])
def list_bank(
    skill_id: uuid.UUID, db: Db, user: Staff, bank: Bank, level: int | None = Query(default=None, ge=1, le=5)
) -> list[BankQuestion]:
    """The shared questions of a built-in skill, easiest first."""
    s = bank_skill(db, user, skill_id)
    return [BankQuestion(id=q["id"], title=q["title"], kind=q["kind"], level=q["level"]) for q in bank.problems(s.key, level)]


@app.get("/skills/{skill_id}/bank/{question_id}", response_model=BankQuestionOut, tags=["shared bank"])
def read_bank(skill_id: uuid.UUID, question_id: uuid.UUID, db: Db, user: Staff, bank: Bank) -> BankQuestionOut:
    """One shared question with its right answers; code questions show only their visible test cases."""
    q = bank_question(bank, bank_skill(db, user, skill_id), str(question_id))
    shown = [x for x in q.get("scenarios", []) if not x.get("hidden")]
    return BankQuestionOut(
        id=q["id"],
        title=q["title"],
        kind=q["kind"],
        level=q["level"],
        statement=q["statement"],
        choices=q.get("choices"),
        correct_choices=q.get("correct_choices"),
        starter_code=q.get("starter_code") if q["kind"] == "code" else None,
        examples=[{"name": x["name"], "input": x["input"], "expected_output": x["expected_output"]} for x in shown],
        hidden_tests=len(q.get("scenarios", [])) - len(shown),
        timer_seconds=q["timer_seconds"],
    )


@app.post("/skills/{skill_id}/bank/{question_id}/copy", response_model=QuestionOut, status_code=201, tags=["shared bank"])
def copy_bank(question_id: uuid.UUID, skill_id: uuid.UUID, body: CopyIn, db: Db, user: Staff, people: People, bank: Bank) -> QuestionOut:
    """Copies a shared QCM into the company's library as the caller's draft, to adapt and send for validation."""
    q = bank_question(bank, bank_skill(db, user, skill_id), str(question_id))
    if q["kind"] != "qcm":
        raise ApiError(409, "not_copyable", "Only QCM questions can be copied: code questions stay in the shared bank")
    own_skill(db, user, body.skill_id)
    draft = Question(
        tenant_id=user.tenant_id,
        author_id=uuid.UUID(user.sub),
        status="draft",
        skill_id=body.skill_id,
        level=q["level"],
        kind="qcm",
        title=q["title"][:200],
        statement=q["statement"],
        choices=q["choices"],
        correct_choices=q["correct_choices"],
        timer_seconds=max(15, q["timer_seconds"]),
        explanation="",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return question_out(draft, user, people)


# --- internal ---------------------------------------------------------------


@app.get("/internal/stock", response_model=list[StockRow], tags=["internal"])
def internal_stock(db: Db, _: Service, tenant_id: uuid.UUID = Query()) -> list[StockRow]:
    """A company's approved questions per skill and level."""
    rows = db.execute(
        select(Skill.key, Question.level, func.count())
        .join(Skill, Skill.id == Question.skill_id)
        .where(Question.tenant_id == tenant_id, Question.status == "approved")
        .group_by(Skill.key, Question.level)
    )
    return [StockRow(language=k, level=lv, count=n) for k, lv, n in rows]


@app.get("/internal/skills", tags=["internal"])
def internal_skills(db: Db, _: Service, tenant_id: uuid.UUID = Query()) -> dict[str, str]:
    """Skill key → name, for the skills this company sees."""
    return {s.key: s.name for s in db.scalars(select(Skill).where(visible(Skill, tenant_id)))}


@app.post("/internal/draw", response_model=list[FullQuestion], tags=["internal"])
def draw(body: DrawIn, db: Db, _: Service) -> list[FullQuestion]:
    """Draws approved questions for one candidate: per row, the least used first, at random among equals."""
    drawn: list[Question] = []
    for row in body.rows:
        pool = list(
            db.scalars(
                select(Question)
                .join(Skill, Skill.id == Question.skill_id)
                .where(
                    Question.tenant_id == body.tenant_id,
                    Question.status == "approved",
                    Skill.key == row.language,
                    Question.level == row.level,
                )
            )
        )
        if len(pool) < row.count:
            raise ApiError(
                409, "not_enough_questions", f"{row.language} level {row.level}: {len(pool)} approved questions, {row.count} asked"
            )
        random.shuffle(pool)
        pool.sort(key=lambda q: q.used_count)
        drawn.extend(pool[: row.count])
    for q in drawn:
        q.used_count += 1
    db.commit()
    return [full(q) for q in drawn]


class IdsIn(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=200)


@app.post("/internal/questions", response_model=list[FullQuestion], tags=["internal"])
def internal_questions(body: IdsIn, db: Db, _: Service) -> list[FullQuestion]:
    """These questions with their answers, whatever their status (tests keep retired questions)."""
    if not body.ids:
        return []
    return [full(q) for q in db.scalars(select(Question).where(Question.id.in_(body.ids)))]


@app.get("/internal/questions/{question_id}", response_model=FullQuestion, tags=["internal"])
def internal_question(question_id: uuid.UUID, db: Db, _: Service) -> FullQuestion:
    """One question with its answer, whatever its status (tests keep retired questions)."""
    q = db.get(Question, question_id)
    if q is None:
        raise ApiError(404, "not_found", "Question not found")
    return full(q)
