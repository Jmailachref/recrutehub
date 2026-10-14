import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import storage
from app.models import Candidate
from rh_common import ApiError, Principal, create_app, internal, queue, require_role
from rh_common.db import get_session

app = create_app("candidates")

Db = Annotated[Session, Depends(get_session)]
Staff = Annotated[Principal, Depends(require_role("admin", "editor", "recruiter"))]
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
    cv_score: int | None
    created_at: datetime


def candidate_out(c: Candidate) -> CandidateOut:
    return CandidateOut(
        id=c.id,
        offer_id=c.offer_id,
        name=c.name,
        email=c.email,
        phone=c.phone,
        status=c.status,
        cv_size=c.cv_size,
        cv_score=c.cv_score,
        created_at=c.created_at,
    )


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
    offer_id: uuid.UUID | None = Query(default=None),
    status: Status | None = Query(default=None),
) -> list[CandidateOut]:
    """Applications to this company's offers, newest first."""
    query = select(Candidate).where(Candidate.tenant_id == user.tenant_id).order_by(Candidate.created_at.desc())
    if offer_id is not None:
        query = query.where(Candidate.offer_id == offer_id)
    if status is not None:
        query = query.where(Candidate.status == status)
    return [candidate_out(c) for c in db.scalars(query)]


@app.get("/candidates/{candidate_id}", response_model=CandidateOut, tags=["candidates"])
def read_candidate(candidate_id: uuid.UUID, db: Db, user: Staff) -> CandidateOut:
    return candidate_out(own_candidate(db, user, candidate_id))


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


@app.post("/internal/candidates/{candidate_id}/status", response_model=InternalCandidateOut, tags=["internal"])
def internal_set_status(candidate_id: uuid.UUID, body: StatusIn, db: Db, _: Service) -> InternalCandidateOut:
    """Moves an application along as its test progresses (invited, tested)."""
    c = db.get(Candidate, candidate_id)
    if c is None:
        raise ApiError(404, "not_found", "Candidate not found")
    c.status = body.status
    db.commit()
    return internal_out(c)
