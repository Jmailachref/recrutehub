"""skills chosen for an offer, with their priorities

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_offers", sa.Column("skills", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("job_offers", "skills")
