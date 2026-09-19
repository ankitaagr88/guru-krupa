"""appointment.visit_id, ot_cases.updated_at

Revision ID: 1a2b3c4d5e6f
Revises: 02b4444593ba
"""
import sqlalchemy as sa
from alembic import op

revision = "1a2b3c4d5e6f"
down_revision = "02b4444593ba"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("appointments") as b:
        b.add_column(sa.Column("visit_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_appointments_visit_id", "visits", ["visit_id"], ["id"])
    with op.batch_alter_table("ot_cases") as b:
        b.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE ot_cases SET updated_at = created_at WHERE updated_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table("ot_cases") as b:
        b.drop_column("updated_at")
    with op.batch_alter_table("appointments") as b:
        b.drop_constraint("fk_appointments_visit_id", type_="foreignkey")
        b.drop_column("visit_id")
