"""how experienced each employee is

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
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("experience", sa.Integer(), nullable=False, server_default="1"))
        batch.create_check_constraint("ck_users_experience", "experience BETWEEN 1 AND 4")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_experience", type_="check")
        batch.drop_column("experience")
