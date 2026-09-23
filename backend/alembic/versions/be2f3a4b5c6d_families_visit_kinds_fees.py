"""families on one mobile number, visit kinds + clinic fee rules, eye-wise charges

Revision ID: be2f3a4b5c6d
Revises: ad1e2f3a4b5c
"""
import sqlalchemy as sa
from alembic import op

revision = "be2f3a4b5c6d"
down_revision = "ad1e2f3a4b5c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "relations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "visit_kinds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("standard_charge_id", sa.Integer(), sa.ForeignKey("standard_charges.id"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "clinic_settings",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )

    with op.batch_alter_table("patients") as b:
        b.add_column(sa.Column("family_owner_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("relation_key", sa.String(30), nullable=True))
        b.create_foreign_key("fk_patients_family_owner_id", "patients", ["family_owner_id"], ["id"])
        b.create_index("ix_patients_family_owner_id", ["family_owner_id"])

    with op.batch_alter_table("visits") as b:
        b.add_column(sa.Column("visit_kind_key", sa.String(30), nullable=True))
        b.add_column(sa.Column("emergency", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("standard_charges") as b:
        b.add_column(sa.Column("amount_both_eyes", sa.Integer(), nullable=True))
        b.add_column(sa.Column("group_label", sa.String(40), nullable=False, server_default=""))

    with op.batch_alter_table("bill_items") as b:
        b.add_column(sa.Column("eyes", sa.String(10), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bill_items") as b:
        b.drop_column("eyes")
    with op.batch_alter_table("standard_charges") as b:
        b.drop_column("group_label")
        b.drop_column("amount_both_eyes")
    with op.batch_alter_table("visits") as b:
        b.drop_column("emergency")
        b.drop_column("visit_kind_key")
    with op.batch_alter_table("patients") as b:
        b.drop_index("ix_patients_family_owner_id")
        b.drop_constraint("fk_patients_family_owner_id", type_="foreignkey")
        b.drop_column("relation_key")
        b.drop_column("family_owner_id")
    op.drop_table("clinic_settings")
    op.drop_table("visit_kinds")
    op.drop_table("relations")
