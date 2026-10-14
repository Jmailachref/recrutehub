"""Tables owned by the candidates service."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from rh_common.db import Base


class Candidate(Base):
    """One application: a person who applied to one offer, with their CV."""

    __tablename__ = "candidates"
    __table_args__ = (
        UniqueConstraint("offer_id", "email", name="uq_candidates_offer_email"),
        CheckConstraint(
            "status IN ('applied', 'shortlisted', 'invited', 'tested', 'rejected', 'hired')",
            name="ck_candidates_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    offer_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="applied")
    # Where the CV lives in the bucket: <tenant>/<offer>/<candidate>.pdf
    cv_key: Mapped[str] = mapped_column(String(300))
    cv_size: Mapped[int] = mapped_column(Integer)
    cv_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
