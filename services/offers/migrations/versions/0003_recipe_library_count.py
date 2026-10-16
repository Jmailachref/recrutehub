"""questions drawn from the company's own library

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("offer_recipe") as batch:
        batch.add_column(sa.Column("library_count", sa.Integer(), nullable=False, server_default="0"))
        batch.drop_constraint("ck_offer_recipe_counts", type_="check")
        batch.create_check_constraint("ck_offer_recipe_counts", "code_count >= 0 AND qcm_count >= 0 AND library_count >= 0")


def downgrade() -> None:
    with op.batch_alter_table("offer_recipe") as batch:
        batch.drop_constraint("ck_offer_recipe_counts", type_="check")
        batch.create_check_constraint("ck_offer_recipe_counts", "code_count >= 0 AND qcm_count >= 0")
        batch.drop_column("library_count")
