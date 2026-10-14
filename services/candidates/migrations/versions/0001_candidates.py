"""candidates

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
        "candidates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("offer_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("cv_key", sa.String(300), nullable=False),
        sa.Column("cv_size", sa.Integer(), nullable=False),
        sa.Column("cv_score", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        sa.UniqueConstraint("offer_id", "email", name="uq_candidates_offer_email"),
        sa.CheckConstraint(
            "status IN ('applied', 'shortlisted', 'invited', 'tested', 'rejected', 'hired')",
            name="ck_candidates_status",
        ),
    )


def downgrade() -> None:
    op.drop_table("candidates")
