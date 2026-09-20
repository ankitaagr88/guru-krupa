"""prescription_lines: dispensed_qty / dispensed_at / dispensed_by_id — the front desk confirms each
medicine was bought from the clinic; only that moves stock (the doctor's qty_given is "to give").

Revision ID: 8b92a3b4c5d6
Revises: 7a8192a3b4c5
"""
import sqlalchemy as sa
from alembic import op

revision = "8b92a3b4c5d6"
down_revision = "7a8192a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("prescription_lines") as b:
        b.add_column(sa.Column("dispensed_qty", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("dispensed_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("dispensed_by_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_prescription_lines_dispensed_by_id_staff", "staff", ["dispensed_by_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("prescription_lines") as b:
        b.drop_constraint("fk_prescription_lines_dispensed_by_id_staff", type_="foreignkey")
        b.drop_column("dispensed_by_id")
        b.drop_column("dispensed_at")
        b.drop_column("dispensed_qty")
