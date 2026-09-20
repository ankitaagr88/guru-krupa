"""inventory_items.ordered_at — "we have placed the order" (silences the low-stock alert until stock is received)

Revision ID: 7a8192a3b4c5
Revises: 6f708192a3b4
"""
import sqlalchemy as sa
from alembic import op

revision = "7a8192a3b4c5"
down_revision = "6f708192a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_items") as b:
        b.add_column(sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("ordered_qty", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("inventory_items") as b:
        b.drop_column("ordered_qty")
        b.drop_column("ordered_at")
