"""tests with questions from the company's own library

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("test_sessions") as batch:
        batch.alter_column("codeplay_test_id", existing_type=sa.Uuid(), nullable=True)
    with op.batch_alter_table("answers") as batch:
        batch.add_column(sa.Column("source", sa.String(10), nullable=False, server_default="codeplay"))
        batch.add_column(sa.Column("value", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("answers") as batch:
        batch.drop_column("value")
        batch.drop_column("source")
    with op.batch_alter_table("test_sessions") as batch:
        batch.alter_column("codeplay_test_id", existing_type=sa.Uuid(), nullable=False)
