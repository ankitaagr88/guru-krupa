"""staff.phone — mobile number on every staff login, for identification

Revision ID: 9c03b4c5d6e7
Revises: 8b92a3b4c5d6
"""
import sqlalchemy as sa
from alembic import op

revision = "9c03b4c5d6e7"
down_revision = "8b92a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("staff") as b:
        b.add_column(sa.Column("phone", sa.String(20), nullable=True))
    op.create_index("ix_staff_phone", "staff", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_staff_phone", table_name="staff")
    with op.batch_alter_table("staff") as b:
        b.drop_column("phone")
