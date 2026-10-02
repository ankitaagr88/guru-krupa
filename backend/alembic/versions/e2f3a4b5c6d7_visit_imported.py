"""visits.imported — the visit came from the previous system (KiviHealth). Visits imported earlier were
marked only by their note ("Imported from the previous system"); they are flagged here too.

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
"""
import sqlalchemy as sa
from alembic import op

revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("visits") as b:
        b.add_column(sa.Column("imported", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE visits SET imported = TRUE WHERE note LIKE 'Imported from%'")


def downgrade() -> None:
    with op.batch_alter_table("visits") as b:
        b.drop_column("imported")
