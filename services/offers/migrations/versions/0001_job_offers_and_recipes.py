"""job offers and their test recipes

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_offers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("public_token", sa.String(32), nullable=False, unique=True),
        sa.Column("question_budget", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("cv_score_threshold", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("weight_theory", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("weight_practice", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'active', 'archived')", name="ck_job_offers_status"),
        sa.CheckConstraint("weight_theory >= 0 AND weight_practice >= 0", name="ck_job_offers_weights"),
    )
    op.create_table(
        "offer_recipe",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("offer_id", sa.Uuid(), sa.ForeignKey("job_offers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("language", sa.String(30), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("code_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("qcm_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("level BETWEEN 1 AND 5", name="ck_offer_recipe_level"),
        sa.CheckConstraint("code_count >= 0 AND qcm_count >= 0", name="ck_offer_recipe_counts"),
    )


def downgrade() -> None:
    op.drop_table("offer_recipe")
    op.drop_table("job_offers")
