"""patients.external_id — the id from the previous system (KiviHealth "Local Id", e.g. GK1234)

Revision ID: 6f708192a3b4
Revises: 5e6f708192a3
"""
import sqlalchemy as sa
from alembic import op

revision = "6f708192a3b4"
down_revision = "5e6f708192a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("patients") as b:
        b.add_column(sa.Column("external_id", sa.String(40), nullable=True))
    op.create_index("ix_patients_external_id", "patients", ["external_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_patients_external_id", table_name="patients")
    with op.batch_alter_table("patients") as b:
        b.drop_column("external_id")
