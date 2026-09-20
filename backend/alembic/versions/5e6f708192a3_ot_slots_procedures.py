"""ot_slots + ot_procedures: admin-configurable OT time slots and procedure list

Revision ID: 5e6f708192a3
Revises: 4d5e6f708192
"""
import sqlalchemy as sa
from alembic import op

revision = "5e6f708192a3"
down_revision = "4d5e6f708192"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ot_slots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(20), nullable=False, unique=True),  # "9:00 AM"
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "ot_procedures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("ot_procedures")
    op.drop_table("ot_slots")
