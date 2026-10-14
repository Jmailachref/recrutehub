"""test sessions and answers

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
        "test_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("offer_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("candidate_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("candidate_name", sa.String(200), nullable=False),
        sa.Column("candidate_email", sa.String(255), nullable=False),
        sa.Column("offer_title", sa.String(255), nullable=False),
        sa.Column("codeplay_test_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("weight_theory", sa.Float(), nullable=False),
        sa.Column("weight_practice", sa.Float(), nullable=False),
        sa.Column("invited_by", sa.Uuid(), nullable=False),
        sa.Column("invited_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("link_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("theory_score", sa.Float(), nullable=True),
        sa.Column("practice_score", sa.Float(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.CheckConstraint(
            "status IN ('invited', 'in_progress', 'submitted', 'scored', 'expired')", name="ck_test_sessions_status"
        ),
    )
    op.create_table(
        "answers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("test_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("problem_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("language", sa.String(30), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("choices", sa.JSON(), nullable=True),
        sa.Column("source_code", sa.Text(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submission_id", sa.Uuid(), nullable=True),
        sa.Column("verdict", sa.String(40), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.UniqueConstraint("session_id", "problem_id", name="uq_answers_session_problem"),
    )


def downgrade() -> None:
    op.drop_table("answers")
    op.drop_table("test_sessions")
