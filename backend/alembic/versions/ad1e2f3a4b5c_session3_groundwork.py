"""session 3 groundwork: patient DOB, visit diagnosis + follow-up, medicine price, standard charges,
bill line links and receipt number, appointment source visit + note

Revision ID: ad1e2f3a4b5c
Revises: 9c03b4c5d6e7
"""
import sqlalchemy as sa
from alembic import op

revision = "ad1e2f3a4b5c"
down_revision = "9c03b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("patients") as b:
        b.add_column(sa.Column("dob", sa.Date(), nullable=True))
        b.add_column(sa.Column("age_recorded_on", sa.Date(), nullable=True))

    with op.batch_alter_table("visits") as b:
        b.add_column(sa.Column("diagnosis_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("follow_up_date", sa.Date(), nullable=True))
        b.create_foreign_key("fk_visits_diagnosis_id", "diagnoses", ["diagnosis_id"], ["id"])
        b.create_index("ix_visits_diagnosis_id", ["diagnosis_id"])

    with op.batch_alter_table("medicines") as b:
        b.add_column(sa.Column("price", sa.Integer(), nullable=True))

    op.create_table(
        "standard_charges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False, unique=True),
        sa.Column("amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    with op.batch_alter_table("bills") as b:
        b.add_column(sa.Column("receipt_no", sa.String(20), nullable=True))
        b.create_unique_constraint("uq_bills_receipt_no", ["receipt_no"])

    with op.batch_alter_table("bill_items") as b:
        b.add_column(sa.Column("kind", sa.String(20), nullable=False, server_default="other"))
        b.add_column(sa.Column("qty", sa.Integer(), nullable=False, server_default="1"))
        b.add_column(sa.Column("standard_charge_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("prescription_line_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_bill_items_standard_charge_id", "standard_charges", ["standard_charge_id"], ["id"])
        b.create_foreign_key("fk_bill_items_prescription_line_id", "prescription_lines",
                             ["prescription_line_id"], ["id"])

    with op.batch_alter_table("appointments") as b:
        b.add_column(sa.Column("source_visit_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("note", sa.String(255), nullable=False, server_default=""))
        b.create_foreign_key("fk_appointments_source_visit_id", "visits", ["source_visit_id"], ["id"])
        b.create_index("ix_appointments_source_visit_id", ["source_visit_id"])


def downgrade() -> None:
    with op.batch_alter_table("appointments") as b:
        b.drop_index("ix_appointments_source_visit_id")
        b.drop_constraint("fk_appointments_source_visit_id", type_="foreignkey")
        b.drop_column("note")
        b.drop_column("source_visit_id")

    with op.batch_alter_table("bill_items") as b:
        b.drop_constraint("fk_bill_items_prescription_line_id", type_="foreignkey")
        b.drop_constraint("fk_bill_items_standard_charge_id", type_="foreignkey")
        b.drop_column("prescription_line_id")
        b.drop_column("standard_charge_id")
        b.drop_column("qty")
        b.drop_column("kind")

    with op.batch_alter_table("bills") as b:
        b.drop_constraint("uq_bills_receipt_no", type_="unique")
        b.drop_column("receipt_no")

    op.drop_table("standard_charges")

    with op.batch_alter_table("medicines") as b:
        b.drop_column("price")

    with op.batch_alter_table("visits") as b:
        b.drop_index("ix_visits_diagnosis_id")
        b.drop_constraint("fk_visits_diagnosis_id", type_="foreignkey")
        b.drop_column("follow_up_date")
        b.drop_column("diagnosis_id")

    with op.batch_alter_table("patients") as b:
        b.drop_column("age_recorded_on")
        b.drop_column("dob")
