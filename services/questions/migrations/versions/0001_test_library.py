"""the test library: domains, skills and each company's questions

Revision ID: 0001
Revises:
Create Date: 2026-10-16
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# The built-in domain of Code Playground's languages and topics (app.main.TECH_DOMAIN).
TECH_DOMAIN = uuid.UUID("00000000-0000-4000-8000-000000000001")
TECH_SKILLS = {
    "python": "Python",
    "javascript": "JavaScript",
    "java": "Java",
    "cpp": "C++",
    "go": "Go",
    "sql": "SQL",
    "docker": "Docker",
}


def upgrade() -> None:
    domains = op.create_table(
        "domains",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True, index=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    skills = op.create_table(
        "skills",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True, index=True),
        sa.Column("domain_id", sa.Uuid(), sa.ForeignKey("domains.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("key", sa.String(30), nullable=False, index=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # One skill per key: among built-in skills, and among each company's.
    op.create_index("uq_skills_builtin_key", "skills", ["key"], unique=True, postgresql_where=sa.text("tenant_id IS NULL"))
    op.create_index("uq_skills_tenant_key", "skills", ["tenant_id", "key"], unique=True)
    op.create_table(
        "library_questions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("skill_id", sa.Uuid(), sa.ForeignKey("skills.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False, server_default=""),
        sa.Column("choices", sa.JSON(), nullable=True),
        sa.Column("correct_choices", sa.JSON(), nullable=True),
        sa.Column("answer_value", sa.Float(), nullable=True),
        sa.Column("tolerance", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("timer_seconds", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft", index=True),
        sa.Column("author_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("replaces_id", sa.Uuid(), sa.ForeignKey("library_questions.id"), nullable=True),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("level BETWEEN 1 AND 5", name="ck_library_questions_level"),
        sa.CheckConstraint("kind IN ('qcm', 'numeric')", name="ck_library_questions_kind"),
        sa.CheckConstraint(
            "status IN ('draft', 'pending', 'approved', 'rejected', 'retired')", name="ck_library_questions_status"
        ),
    )
    op.bulk_insert(
        domains,
        [{"id": TECH_DOMAIN, "tenant_id": None, "name": "Dev / Data / Technique", "description": "Programming languages, databases and DevOps, with code questions run by Code Playground"}],
    )
    op.bulk_insert(
        skills,
        [{"id": uuid.uuid4(), "tenant_id": None, "domain_id": TECH_DOMAIN, "key": k, "name": n} for k, n in TECH_SKILLS.items()],
    )


def downgrade() -> None:
    op.drop_table("library_questions")
    op.drop_table("skills")
    op.drop_table("domains")
