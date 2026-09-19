"""readings: approved_at / approved_by_id (image deleted once values are approved)

Revision ID: 3c4d5e6f7081
Revises: 2b3c4d5e6f70
"""
import sqlalchemy as sa
from alembic import op

revision = "3c4d5e6f7081"
down_revision = "2b3c4d5e6f70"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("readings") as b:
        b.add_column(sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("approved_by_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_readings_approved_by_id_staff", "staff", ["approved_by_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("readings") as b:
        b.drop_constraint("fk_readings_approved_by_id_staff", type_="foreignkey")
        b.drop_column("approved_by_id")
        b.drop_column("approved_at")
