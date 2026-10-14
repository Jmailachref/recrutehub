"""Tables owned by the offers service."""

import secrets
import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rh_common.db import Base


def new_public_token() -> str:
    return secrets.token_urlsafe(12)


class JobOffer(Base):
    __tablename__ = "job_offers"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'active', 'archived')", name="ck_job_offers_status"),
        CheckConstraint("weight_theory >= 0 AND weight_practice >= 0", name="ck_job_offers_weights"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # The apply link: /apply/<public_token>. Works only while the offer is active.
    public_token: Mapped[str] = mapped_column(String(32), unique=True, default=new_public_token)
    question_budget: Mapped[int] = mapped_column(Integer, default=20)
    cv_score_threshold: Mapped[int] = mapped_column(Integer, default=60)
    weight_theory: Mapped[float] = mapped_column(Float, default=0.5)
    weight_practice: Mapped[float] = mapped_column(Float, default=0.5)
    # What the recruiter asked for: [{"language": "python", "priority": 1}, ...].
    # Priorities 1-3 are tested; 4 (CV only) and 5 (bonus) are not.
    skills: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    recipe: Mapped[list["RecipeRow"]] = relationship(
        back_populates="offer", cascade="all, delete-orphan", order_by="RecipeRow.position", lazy="selectin"
    )


class RecipeRow(Base):
    """How many code and QCM questions of one language (or topic) and level the test has."""

    __tablename__ = "offer_recipe"
    __table_args__ = (
        CheckConstraint("level BETWEEN 1 AND 5", name="ck_offer_recipe_level"),
        CheckConstraint("code_count >= 0 AND qcm_count >= 0", name="ck_offer_recipe_counts"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_offers.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(30))
    level: Mapped[int] = mapped_column(Integer)
    code_count: Mapped[int] = mapped_column(Integer, default=0)
    qcm_count: Mapped[int] = mapped_column(Integer, default=0)

    offer: Mapped[JobOffer] = relationship(back_populates="recipe")
