"""day book + prescription print groundwork: day-book columns (account heads) on charges and bill
lines, part payments, cash drawer (opening cash + cash taken out), visit glasses prescription and
exam findings, admin lists of exam findings and lens types

Every bill already paid gets one payment row for its whole total, so past collections still add up.

Revision ID: cf3a4b5c6d7e
Revises: be2f3a4b5c6d
"""
import sqlalchemy as sa
from alembic import op

revision = "cf3a4b5c6d7e"
down_revision = "be2f3a4b5c6d"
branch_labels = None
depends_on = None


def _json():
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "account_heads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    with op.batch_alter_table("standard_charges") as b:
        b.add_column(sa.Column("account_head_key", sa.String(30), nullable=True))
    with op.batch_alter_table("bill_items") as b:
        b.add_column(sa.Column("account_head_key", sa.String(30), nullable=True))

    op.create_table(
        "bill_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bill_id", sa.Integer(), sa.ForeignKey("bills.id"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("note", sa.String(255), nullable=False, server_default=""),
    )
    op.create_index("ix_bill_payments_bill_id", "bill_payments", ["bill_id"])
    op.create_index("ix_bill_payments_at", "bill_payments", ["at"])
    op.execute(
        "INSERT INTO bill_payments (bill_id, amount, mode, at, note) "
        "SELECT b.id, COALESCE((SELECT SUM(i.amount) FROM bill_items i WHERE i.bill_id = b.id), 0), "
        "COALESCE(b.payment_mode, 'cash'), b.paid_at, '' FROM bills b "
        "WHERE b.paid_at IS NOT NULL "
        "AND COALESCE((SELECT SUM(i.amount) FROM bill_items i WHERE i.bill_id = b.id), 0) > 0"
    )

    op.create_table(
        "cash_days",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("opening_cash", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("set_by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(255), nullable=False, server_default=""),
    )
    op.create_table(
        "cash_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("direction", sa.String(3), nullable=False, server_default="out"),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("person", sa.String(80), nullable=False, server_default=""),
        sa.Column("reason", sa.String(255), nullable=False, server_default=""),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
    )
    op.create_index("ix_cash_movements_day", "cash_movements", ["day"])

    with op.batch_alter_table("visits") as b:
        b.add_column(sa.Column("glasses", _json(), nullable=True))
        b.add_column(sa.Column("exam", _json(), nullable=False, server_default="[]"))

    op.create_table(
        "exam_findings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("default_value", sa.String(80), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "lens_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_table("lens_types")
    op.drop_table("exam_findings")
    with op.batch_alter_table("visits") as b:
        b.drop_column("exam")
        b.drop_column("glasses")
    op.drop_index("ix_cash_movements_day", table_name="cash_movements")
    op.drop_table("cash_movements")
    op.drop_table("cash_days")
    op.drop_index("ix_bill_payments_at", table_name="bill_payments")
    op.drop_index("ix_bill_payments_bill_id", table_name="bill_payments")
    op.drop_table("bill_payments")
    with op.batch_alter_table("bill_items") as b:
        b.drop_column("account_head_key")
    with op.batch_alter_table("standard_charges") as b:
        b.drop_column("account_head_key")
    op.drop_table("account_heads")
