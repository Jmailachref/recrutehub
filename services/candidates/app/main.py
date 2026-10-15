import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import storage
from app.cv import points_by_candidate, send_cv
from app.models import Candidate
from rh_common import ApiError, Principal, create_app, internal, queue, require_role
from rh_common.cvanalyzer import CvAnalyzer, cvanalyzer
from rh_common.db import get_session

app = create_app("candidates")

Db = Annotated[Session, Depends(get_session)]
Staff = Annotated[Principal, Depends(require_role("admin", "editor", "recruiter"))]
Writer = Annotated[Principal, Depends(require_role("admin", "recruiter"))]
Analyzer = Annotated[CvAnalyzer, Depends(cvanalyzer)]
MAX_CV_BYTES = 10 * 1024 * 1024
APPLY_LIMIT_PER_HOUR = 10
EMAIL = r"^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$"
Status = Literal["applied", "shortlisted", "invited", "tested", "rejected", "hired"]


class StatusIn(BaseModel):
    status: Status


class InternalCandidateOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    offer_id: uuid.UUID
    name: str
    email: str
    status: str


class Applied(BaseModel):
    id: uuid.UUID
    message: str


class CandidateOut(BaseModel):
    id: uuid.UUID
    offer_id: uuid.UUID
    name: str
    email: str
    phone: str | None
    status: str
    cv_size: int
    cv_score: float | None = Field(description="The CV's points: keyword points plus the recruiters' points, no bound")
    cv_status: str | None = Field(description="queued, processing, ready, unreadable or failed; empty until the CV is sent")
    cv_missing: list[str] = Field(description="Core skills the CV does not show")
    created_at: datetime


def candidate_out(c: Candidate, points: dict | None = None) -> CandidateOut:
    points = points or {}
    return CandidateOut(
        id=c.id,
        offer_id=c.offer_id,
        name=c.name,
        email=c.email,
        phone=c.phone,
        status=c.status,
        cv_size=c.cv_size,
        cv_score=points.get("total"),
        cv_status=points.get("status"),
        cv_missing=points.get("missing") or [],
        created_at=c.created_at,
    )


def with_points(candidates: list[Candidate], analyzer: CvAnalyzer) -> list[CandidateOut]:
    """Adds each CV's points. CVs not sent to the analyzer yet (applied before it was there) are sent now."""
    for c in candidates:
        if c.cv_document_id is None:
            queue.enqueue("candidates", "send_cv", candidate_id=str(c.id))
    points = points_by_candidate(analyzer, {c.offer_id for c in candidates})
    return [candidate_out(c, points.get(str(c.id))) for c in candidates]


class Box(BaseModel):
    page: int = Field(ge=1)
    x0: float
    top: float
    x1: float
    bottom: float


class HighlightIn(BaseModel):
    """Points a recruiter gives a passage of the CV: selected in the PDF (quote, page, boxes) or a line."""

    quote: str | None = Field(default=None, min_length=1, max_length=2000)
    page: int | None = Field(default=None, ge=1)
    boxes: list[Box] | None = Field(default=None, max_length=100)
    line: int | None = Field(default=None, ge=0)
    points: int = Field(ge=-100, le=100, description="Negative for a red flag; not 0")
    comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def one_target(self) -> "HighlightIn":
        if self.points == 0:
            raise ValueError("points cannot be 0")
        if (self.quote is None) == (self.line is None):
            raise ValueError("send a quote or a line")
        return self


def own_candidate(db: Session, user: Principal, candidate_id: uuid.UUID) -> Candidate:
    c = db.get(Candidate, candidate_id)
    if c is None or c.tenant_id != user.tenant_id:
        raise ApiError(404, "not_found", "Candidate not found")
    return c


# --- public -----------------------------------------------------------------


@app.post("/apply/{token}", response_model=Applied, status_code=201, tags=["public"])
async def apply(
    token: str,
    request: Request,
    db: Db,
    name: Annotated[str, Form(min_length=1, max_length=200)],
    email: Annotated[str, Form(max_length=255, pattern=EMAIL)],
    cv: Annotated[UploadFile, File(description="The CV, a PDF of at most 10 MB")],
    phone: Annotated[str | None, Form(max_length=40)] = None,
) -> Applied:
    """Applies to an open offer from its public link. No sign-in."""
    visitor = request.client.host if request.client else "unknown"
    if queue.over_limit(f"apply:{visitor}", APPLY_LIMIT_PER_HOUR, 3600):
        raise ApiError(429, "rate_limited", "Too many applications from this address; try again later")

    try:
        offer = internal.call("GET", "offers", f"/internal/offers/by-token/{token}")
    except ApiError as exc:
        if exc.status != 404:
            raise
        offer = None
    if offer is None or offer["status"] != "active":
        raise ApiError(404, "not_found", "This offer is not open")

    data = await cv.read(MAX_CV_BYTES + 1)
    if len(data) > MAX_CV_BYTES:
        raise ApiError(413, "file_too_large", "The CV must be 10 MB or less")
    if not data.startswith(b"%PDF-"):
        raise ApiError(422, "not_a_pdf", "The CV must be a PDF file")

    email = email.strip().lower()
    offer_id = uuid.UUID(offer["id"])
    if db.scalar(select(Candidate.id).where(Candidate.offer_id == offer_id, Candidate.email == email)):
        raise ApiError(409, "already_applied", "You already applied to this offer with this email")

    candidate = Candidate(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(offer["tenant_id"]),
        offer_id=offer_id,
        name=name.strip(),
        email=email,
        phone=(phone or "").strip() or None,
        cv_size=len(data),
    )
    candidate.cv_key = f"{candidate.tenant_id}/{offer_id}/{candidate.id}.pdf"
    storage.put_pdf(candidate.cv_key, data)
    db.add(candidate)
    try:
        db.commit()
    except IntegrityError:
        # Two submissions raced; the first one won.
        db.rollback()
        storage.delete(candidate.cv_key)
        raise ApiError(409, "already_applied", "You already applied to this offer with this email") from None

    queue.enqueue("candidates", "send_cv", candidate_id=str(candidate.id))
    queue.enqueue(
        "notifications",
        "send_email",
        template="application_received",
        to=candidate.email,
        tenant_id=str(candidate.tenant_id),
        data={"name": candidate.name, "offer_title": offer["title"]},
    )
    return Applied(id=candidate.id, message="Application received. Check your inbox for a confirmation email.")


# --- recruiters -------------------------------------------------------------


@app.get("/candidates", response_model=list[CandidateOut], tags=["candidates"])
def list_candidates(
    db: Db,
    user: Staff,
    analyzer: Analyzer,
    offer_id: uuid.UUID | None = Query(default=None),
    status: Status | None = Query(default=None),
) -> list[CandidateOut]:
    """Applications to this company's offers, newest first."""
    query = select(Candidate).where(Candidate.tenant_id == user.tenant_id).order_by(Candidate.created_at.desc())
    if offer_id is not None:
        query = query.where(Candidate.offer_id == offer_id)
    if status is not None:
        query = query.where(Candidate.status == status)
    return with_points(list(db.scalars(query)), analyzer)


@app.get("/candidates/{candidate_id}", response_model=CandidateOut, tags=["candidates"])
def read_candidate(candidate_id: uuid.UUID, db: Db, user: Staff, analyzer: Analyzer) -> CandidateOut:
    return with_points([own_candidate(db, user, candidate_id)], analyzer)[0]


@app.get(
    "/candidates/{candidate_id}/cv",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    tags=["candidates"],
)
def download_cv(candidate_id: uuid.UUID, db: Db, user: Staff) -> Response:
    c = own_candidate(db, user, candidate_id)
    filename = "".join(ch for ch in c.name if ch.isalnum() or ch in " -_").strip() or "cv"
    return Response(
        storage.get_pdf(c.cv_key),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}.pdf"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


# --- CV review --------------------------------------------------------------


def author_names(highlights: list[dict]) -> dict[str, str]:
    ids = sorted({h["author_ref"] for h in highlights})
    if not ids:
        return {}
    try:
        return internal.call("POST", "auth", "/internal/users/names", json={"ids": ids})
    except ApiError:
        return {}


@app.get("/candidates/{candidate_id}/cv-review", tags=["cv review"])
def cv_review(candidate_id: uuid.UUID, db: Db, user: Staff, analyzer: Analyzer) -> dict:
    """The CV as the analyzer read it (lines and their boxes on the PDF) and its points.

    total = auto (the offer grid's keyword points, each competence once) + manual (every
    recruiter's points). No bound.
    """
    c = own_candidate(db, user, candidate_id)
    document_id = str(send_cv(db, c, analyzer))
    document = analyzer.document(document_id)
    score = analyzer.score(document_id)
    analysis = score.get("analysis") or {}
    details = analysis.get("details") or {}
    names = author_names(score["highlights"])
    return {
        "status": document["status"],
        "error": document.get("error"),
        "pages": document.get("pages"),
        "ocr_used": document.get("ocr_used"),
        "lines": document.get("lines") or [],
        "auto": score["auto"],
        "manual": score["manual"],
        "total": score["total"],
        "gained": details.get("gained"),
        "penalties": details.get("penalties"),
        "criteria": details.get("criteria") or [],
        "highlights": [
            {**h, "author_name": names.get(h["author_ref"], "A teammate"), "mine": h["author_ref"] == user.sub}
            for h in score["highlights"]
        ],
    }


@app.post("/candidates/{candidate_id}/cv-highlights", status_code=201, tags=["cv review"])
def add_highlight(candidate_id: uuid.UUID, body: HighlightIn, db: Db, user: Writer, analyzer: Analyzer) -> dict:
    """Gives points to a passage of the CV, from -100 to +100. A passage counts once (409 already_scored)."""
    c = own_candidate(db, user, candidate_id)
    document_id = str(send_cv(db, c, analyzer))
    return analyzer.add_highlight(document_id, {**body.model_dump(exclude_none=True), "author_ref": user.sub})


@app.delete("/candidates/{candidate_id}/cv-highlights/{highlight_id}", status_code=204, tags=["cv review"])
def delete_highlight(candidate_id: uuid.UUID, highlight_id: uuid.UUID, db: Db, user: Writer, analyzer: Analyzer) -> None:
    c = own_candidate(db, user, candidate_id)
    if c.cv_document_id is None or str(highlight_id) not in {h["id"] for h in analyzer.highlights(str(c.cv_document_id))}:
        raise ApiError(404, "not_found", "Highlight not found")
    analyzer.delete_highlight(str(highlight_id))


# --- internal ---------------------------------------------------------------


Service = Annotated[Principal, Depends(require_role("service"))]


def internal_out(c: Candidate) -> InternalCandidateOut:
    return InternalCandidateOut(
        id=c.id, tenant_id=c.tenant_id, offer_id=c.offer_id, name=c.name, email=c.email, status=c.status
    )


@app.get("/internal/candidates/{candidate_id}", response_model=InternalCandidateOut, tags=["internal"])
def internal_candidate(candidate_id: uuid.UUID, db: Db, _: Service) -> InternalCandidateOut:
    c = db.get(Candidate, candidate_id)
    if c is None:
        raise ApiError(404, "not_found", "Candidate not found")
    return internal_out(c)


@app.get("/internal/offers/{offer_id}/count", tags=["internal"])
def internal_count(offer_id: uuid.UUID, db: Db, _: Service) -> dict:
    """How many applications an offer has (offers refuses to delete one that has any)."""
    return {"count": db.scalar(select(func.count()).select_from(Candidate).where(Candidate.offer_id == offer_id))}


@app.post("/internal/candidates/{candidate_id}/status", response_model=InternalCandidateOut, tags=["internal"])
def internal_set_status(candidate_id: uuid.UUID, body: StatusIn, db: Db, _: Service) -> InternalCandidateOut:
    """Moves an application along as its test progresses (invited, tested)."""
    c = db.get(Candidate, candidate_id)
    if c is None:
        raise ApiError(404, "not_found", "Candidate not found")
    c.status = body.status
    db.commit()
    return internal_out(c)
