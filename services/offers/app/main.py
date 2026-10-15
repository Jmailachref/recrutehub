import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, Query
from pydantic import AfterValidator, BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.generator import generate
from app.models import JobOffer, RecipeRow
from rh_common import ApiError, Principal, create_app, internal, require_role
from rh_common.codeplay import CodePlayground, codeplay
from rh_common.cvanalyzer import CvAnalyzer, cvanalyzer
from rh_common.db import get_session

app = create_app("offers")

Db = Annotated[Session, Depends(get_session)]
Bank = Annotated[CodePlayground, Depends(codeplay)]
Analyzer = Annotated[CvAnalyzer, Depends(cvanalyzer)]
Staff = Annotated[Principal, Depends(require_role("admin", "editor", "recruiter"))]
Writer = Annotated[Principal, Depends(require_role("admin", "recruiter"))]
Service = Annotated[Principal, Depends(require_role("service"))]
Topic = Annotated[str, Field(min_length=1, max_length=30, pattern=r"^[a-z0-9][a-z0-9+#.-]*$")]
# A skill: a language or topic of the question bank, or any competence the CV should show.
SkillName = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[\w+#.][\w+#. /&'-]*$")]
MAX_PER_ROW = 20
log = logging.getLogger(__name__)


class SkillIn(BaseModel):
    language: SkillName = Field(description="A question bank language or topic (tested), or any other competence")
    priority: int = Field(ge=1, le=5, description="1 core, 2 important, 3 secondary (tested); 4 CV only, 5 bonus")


def distinct_languages(skills: list[SkillIn]) -> list[SkillIn]:
    if len({s.language.strip().lower() for s in skills}) != len(skills):
        raise ValueError("each skill appears once in an offer")
    return skills


Skills = Annotated[list[SkillIn], Field(max_length=40), AfterValidator(distinct_languages)]


class OfferIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20_000)
    question_budget: int = Field(default=20, ge=1, le=100)
    cv_score_threshold: int = Field(default=60, ge=0, le=100)
    skills: Skills = []


class OfferUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20_000)
    question_budget: int | None = Field(default=None, ge=1, le=100)
    cv_score_threshold: int | None = Field(default=None, ge=0, le=100)
    skills: Skills | None = None


class WeightsIn(BaseModel):
    weight_theory: float = Field(ge=0, le=1)
    weight_practice: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def add_up_to_one(self) -> "WeightsIn":
        if abs(self.weight_theory + self.weight_practice - 1) > 1e-6:
            raise ValueError("weight_theory and weight_practice must add up to 1")
        return self


class RecipeRowIn(BaseModel):
    language: Topic
    level: int = Field(ge=1, le=5)
    code_count: int = Field(default=0, ge=0, le=MAX_PER_ROW)
    qcm_count: int = Field(default=0, ge=0, le=MAX_PER_ROW)


class RecipeIn(BaseModel):
    rows: list[RecipeRowIn] = Field(max_length=30)

    @model_validator(mode="after")
    def distinct_rows(self) -> "RecipeIn":
        keys = [(r.language, r.level) for r in self.rows]
        if len(set(keys)) != len(keys):
            raise ValueError("each language and level appears once in a recipe")
        return self


class RecipeRowOut(RecipeRowIn):
    stock_code: int = Field(description="Approved code questions for this language and level")
    stock_qcm: int = Field(description="Approved QCM questions for this language and level")
    available_levels: list[int] = Field(description="Levels of this language that have questions")


class RecipeWarning(BaseModel):
    code: Literal["budget_mismatch", "stock_low", "empty", "no_stock", "level_adjusted", "stock_reduced"]
    message: str
    row: int | None = None
    skill: str | None = None


class RecipeOut(BaseModel):
    rows: list[RecipeRowOut]
    total: int
    budget: int
    warnings: list[RecipeWarning]


class CriterionIn(BaseModel):
    """One line of the CV grid: words that count as one competence, and its points."""

    id: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=80)
    terms: list[str] = Field(default=[], max_length=40, description="Other words that count as this competence")
    default_synonyms: bool = Field(default=True, description="Also look for the analyzer's synonyms of the label")
    points_present: float = Field(default=1.0, ge=0, le=50, description="Points when the CV shows it")
    points_absent: float = Field(default=0.0, ge=-50, le=0, description="Points lost when it is missing")


class GridIn(BaseModel):
    criteria: list[CriterionIn] | None = Field(default=None, max_length=100, description="The edited grid")
    rebuild: bool = Field(default=False, description="Without criteria: build the grid from the skills again")


class GridOut(BaseModel):
    version: int
    criteria: list[CriterionIn]


class OfferSummary(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    question_count: int
    question_budget: int
    created_at: datetime | None = None


class OfferOut(OfferSummary):
    description: str
    public_token: str
    cv_score_threshold: int
    weight_theory: float
    weight_practice: float
    skills: list[SkillIn]
    recipe: list[RecipeRowIn]


class PublicOfferOut(BaseModel):
    title: str
    description: str


class InternalOfferOut(OfferOut):
    tenant_id: uuid.UUID


class StockRow(BaseModel):
    language: str
    level: int
    code: int
    qcm: int


def total(offer: JobOffer) -> int:
    return sum(r.code_count + r.qcm_count for r in offer.recipe)


def rows_of(offer: JobOffer) -> list[RecipeRowIn]:
    return [
        RecipeRowIn(language=r.language, level=r.level, code_count=r.code_count, qcm_count=r.qcm_count)
        for r in offer.recipe
    ]


def offer_out(offer: JobOffer, model=OfferOut, **extra):
    return model(
        id=offer.id,
        title=offer.title,
        status=offer.status,
        created_at=offer.created_at,
        question_count=total(offer),
        question_budget=offer.question_budget,
        description=offer.description,
        public_token=offer.public_token,
        cv_score_threshold=offer.cv_score_threshold,
        weight_theory=offer.weight_theory,
        weight_practice=offer.weight_practice,
        skills=offer.skills or [],
        recipe=rows_of(offer),
        **extra,
    )


def sync_grid(offer: JobOffer, analyzer: CvAnalyzer) -> None:
    """Sends the offer's title and skills to the CV analyzer, which keeps the grid's edits.

    Best effort: a CV analyzer that is down must not stop recruiters from saving offers;
    the grid catches up the next time it is read.
    """
    try:
        analyzer.save_offer(str(offer.id), offer.title, offer.skills or [])
    except ApiError as exc:
        log.warning("could not send offer %s to the CV analyzer: %s", offer.id, exc.message)


def grid_out(data: dict) -> GridOut:
    return GridOut(version=data["grid_version"], criteria=data["criteria"])


def own_offer(db: Session, user: Principal, offer_id: uuid.UUID) -> JobOffer:
    offer = db.get(JobOffer, offer_id)
    if offer is None or offer.tenant_id != user.tenant_id:
        raise ApiError(404, "not_found", "Offer not found")
    return offer


def stock_index(bank: CodePlayground) -> dict[tuple[str, int], dict]:
    return {(s["language"], s["level"]): s for s in bank.stock()}


def recipe_out(offer: JobOffer, stock: dict[tuple[str, int], dict]) -> RecipeOut:
    rows, warnings = [], []
    for i, r in enumerate(offer.recipe):
        s = stock.get((r.language, r.level), {"code": 0, "qcm": 0})
        levels = sorted(level for (lang, level) in stock if lang == r.language)
        rows.append(
            RecipeRowOut(
                language=r.language,
                level=r.level,
                code_count=r.code_count,
                qcm_count=r.qcm_count,
                stock_code=s["code"],
                stock_qcm=s["qcm"],
                available_levels=levels,
            )
        )
        if r.code_count > s["code"] or r.qcm_count > s["qcm"]:
            warnings.append(
                RecipeWarning(
                    code="stock_low",
                    row=i,
                    message=f"{r.language} level {r.level} asks for more questions than the bank has",
                )
            )
    count = total(offer)
    if count == 0:
        warnings.append(RecipeWarning(code="empty", message="The test has no questions yet"))
    elif count != offer.question_budget:
        warnings.append(
            RecipeWarning(code="budget_mismatch", message=f"The test has {count} questions; the budget is {offer.question_budget}")
        )
    return RecipeOut(rows=rows, total=count, budget=offer.question_budget, warnings=warnings)


# --- offers -----------------------------------------------------------------


@app.get("/offers", response_model=list[OfferSummary], tags=["offers"])
def list_offers(
    db: Db, user: Staff, status: Literal["draft", "active", "archived"] | None = Query(default=None)
) -> list[OfferSummary]:
    query = select(JobOffer).where(JobOffer.tenant_id == user.tenant_id).order_by(JobOffer.created_at.desc())
    if status is not None:
        query = query.where(JobOffer.status == status)
    return [
        OfferSummary(
            id=o.id,
            title=o.title,
            status=o.status,
            question_count=total(o),
            question_budget=o.question_budget,
            created_at=o.created_at,
        )
        for o in db.scalars(query)
    ]


@app.post("/offers", response_model=OfferOut, status_code=201, tags=["offers"])
def create_offer(body: OfferIn, db: Db, user: Writer, analyzer: Analyzer) -> OfferOut:
    offer = JobOffer(tenant_id=user.tenant_id, created_by=uuid.UUID(user.sub), **body.model_dump())
    db.add(offer)
    db.commit()
    db.refresh(offer)
    sync_grid(offer, analyzer)
    return offer_out(offer)


@app.get("/offers/{offer_id}", response_model=OfferOut, tags=["offers"])
def read_offer(offer_id: uuid.UUID, db: Db, user: Staff) -> OfferOut:
    return offer_out(own_offer(db, user, offer_id))


@app.patch("/offers/{offer_id}", response_model=OfferOut, tags=["offers"])
def update_offer(offer_id: uuid.UUID, body: OfferUpdate, db: Db, user: Writer, analyzer: Analyzer) -> OfferOut:
    offer = own_offer(db, user, offer_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(offer, field, value)
    db.commit()
    if "title" in changes or "skills" in changes:
        sync_grid(offer, analyzer)
    return offer_out(offer)


@app.delete("/offers/{offer_id}", status_code=204, tags=["offers"])
def delete_offer(offer_id: uuid.UUID, db: Db, user: Writer, analyzer: Analyzer) -> None:
    """Deletes an offer nobody applied to. Offers with applications are archived instead."""
    offer = own_offer(db, user, offer_id)
    count = internal.call("GET", "candidates", f"/internal/offers/{offer_id}/count")["count"]
    if count:
        raise ApiError(409, "has_candidates", f"{count} candidate(s) applied to this offer: archive it instead")
    db.delete(offer)
    db.commit()
    try:
        analyzer.delete_offer(str(offer_id))
    except ApiError as exc:
        if exc.status != 404:
            log.warning("could not delete offer %s from the CV analyzer: %s", offer_id, exc.message)


@app.patch("/offers/{offer_id}/weights", response_model=OfferOut, tags=["offers"])
def update_weights(offer_id: uuid.UUID, body: WeightsIn, db: Db, user: Writer) -> OfferOut:
    offer = own_offer(db, user, offer_id)
    offer.weight_theory, offer.weight_practice = body.weight_theory, body.weight_practice
    db.commit()
    return offer_out(offer)


@app.post("/offers/{offer_id}/publish", response_model=OfferOut, tags=["offers"])
def publish_offer(offer_id: uuid.UUID, db: Db, user: Writer, bank: Bank) -> OfferOut:
    """Opens the apply link. The test must have questions, all of them in stock."""
    offer = own_offer(db, user, offer_id)
    recipe = recipe_out(offer, stock_index(bank))
    blocking = [w for w in recipe.warnings if w.code in ("empty", "stock_low")]
    if blocking:
        raise ApiError(409, "recipe_not_ready", blocking[0].message)
    offer.status = "active"
    db.commit()
    return offer_out(offer)


@app.post("/offers/{offer_id}/archive", response_model=OfferOut, tags=["offers"])
def archive_offer(offer_id: uuid.UUID, db: Db, user: Writer) -> OfferOut:
    """Closes the apply link. Candidates who already applied keep their tests."""
    offer = own_offer(db, user, offer_id)
    offer.status = "archived"
    db.commit()
    return offer_out(offer)


@app.post("/offers/{offer_id}/restore", response_model=OfferOut, tags=["offers"])
def restore_offer(offer_id: uuid.UUID, db: Db, user: Writer) -> OfferOut:
    """Back to draft; publish it again to reopen the apply link."""
    offer = own_offer(db, user, offer_id)
    if offer.status != "archived":
        raise ApiError(409, "not_archived", "Only archived offers can be restored")
    offer.status = "draft"
    db.commit()
    return offer_out(offer)


# --- CV grid ----------------------------------------------------------------


@app.get("/offers/{offer_id}/grid", response_model=GridOut, tags=["cv grid"])
def read_grid(offer_id: uuid.UUID, db: Db, user: Staff, analyzer: Analyzer) -> GridOut:
    """How CVs are scored for this offer: each competence, the words that show it and its points."""
    offer = own_offer(db, user, offer_id)
    try:
        return grid_out(analyzer.offer(str(offer.id)))
    except ApiError as exc:
        if exc.code != "offer_not_found":
            raise
    return grid_out(analyzer.save_offer(str(offer.id), offer.title, offer.skills or []))


@app.put("/offers/{offer_id}/grid", response_model=GridOut, tags=["cv grid"])
def replace_grid(offer_id: uuid.UUID, body: GridIn, db: Db, user: Writer, analyzer: Analyzer) -> GridOut:
    """Saves the edited grid, or with rebuild builds it from the skills again. Every CV is scored again."""
    offer = own_offer(db, user, offer_id)
    if body.criteria is None and not body.rebuild:
        raise ApiError(400, "invalid_request", "Send criteria, or rebuild")
    criteria = [c.model_dump() for c in body.criteria] if body.criteria is not None else None
    return grid_out(analyzer.save_offer(str(offer.id), offer.title, offer.skills or [], criteria, rebuild=body.rebuild))


# --- recipe -----------------------------------------------------------------


@app.get("/offers/{offer_id}/recipe", response_model=RecipeOut, tags=["recipe"])
def read_recipe(offer_id: uuid.UUID, db: Db, user: Staff, bank: Bank) -> RecipeOut:
    return recipe_out(own_offer(db, user, offer_id), stock_index(bank))


@app.put("/offers/{offer_id}/recipe", response_model=RecipeOut, tags=["recipe"])
def replace_recipe(offer_id: uuid.UUID, body: RecipeIn, db: Db, user: Writer, bank: Bank) -> RecipeOut:
    """Sets which questions the test has: per language (or topic) and level, how many code and QCM.

    Each count must fit what the question bank has. Changing the recipe of a
    published offer affects only candidates who apply afterwards.
    """
    offer = own_offer(db, user, offer_id)
    stock = stock_index(bank)
    for i, row in enumerate(body.rows):
        s = stock.get((row.language, row.level), {"code": 0, "qcm": 0})
        if row.code_count > s["code"] or row.qcm_count > s["qcm"]:
            raise ApiError(
                409,
                "not_enough_questions",
                f"Row {i + 1}: {row.language} level {row.level} has {s['code']} code and {s['qcm']} QCM questions",
            )
    offer.recipe = [RecipeRow(position=i, **row.model_dump()) for i, row in enumerate(body.rows)]
    db.commit()
    db.refresh(offer)
    return recipe_out(offer, stock)


@app.post("/offers/{offer_id}/recipe/generate", response_model=RecipeOut, tags=["recipe"])
def generate_recipe(offer_id: uuid.UUID, db: Db, user: Writer, bank: Bank) -> RecipeOut:
    """Replaces the recipe with one built from the offer's skills, priorities and budget.

    Core skills (priority 1) get three times the questions of secondary ones
    (3), important ones (2) twice. The recruiter can then change any row.
    """
    offer = own_offer(db, user, offer_id)
    stock = stock_index(bank)
    rows, notes = generate(offer.skills or [], offer.question_budget, stock)
    offer.recipe = [RecipeRow(position=i, **row) for i, row in enumerate(rows)]
    db.commit()
    db.refresh(offer)
    out = recipe_out(offer, stock)
    out.warnings = [RecipeWarning(**n) for n in notes] + out.warnings
    return out


@app.get("/stock", response_model=list[StockRow], tags=["recipe"])
def stock(user: Staff, bank: Bank) -> list[StockRow]:
    """Approved questions per language (or topic) and level, for the recipe editor."""
    return [StockRow(**s) for s in bank.stock()]


# --- public and internal ----------------------------------------------------


@app.get("/public/{token}", response_model=PublicOfferOut, tags=["public"])
def public_offer(token: str, db: Db) -> PublicOfferOut:
    """What the apply page shows. No sign-in; only active offers."""
    offer = db.scalar(select(JobOffer).where(JobOffer.public_token == token))
    if offer is None or offer.status != "active":
        raise ApiError(404, "not_found", "This offer is not open")
    return PublicOfferOut(title=offer.title, description=offer.description)


@app.get("/internal/offers/{offer_id}", response_model=InternalOfferOut, tags=["internal"])
def internal_offer(offer_id: uuid.UUID, db: Db, _: Service) -> InternalOfferOut:
    offer = db.get(JobOffer, offer_id)
    if offer is None:
        raise ApiError(404, "not_found", "Offer not found")
    return offer_out(offer, InternalOfferOut, tenant_id=offer.tenant_id)


@app.get("/internal/offers/by-token/{token}", response_model=InternalOfferOut, tags=["internal"])
def internal_offer_by_token(token: str, db: Db, _: Service) -> InternalOfferOut:
    offer = db.scalar(select(JobOffer).where(JobOffer.public_token == token))
    if offer is None:
        raise ApiError(404, "not_found", "Offer not found")
    return offer_out(offer, InternalOfferOut, tenant_id=offer.tenant_id)
