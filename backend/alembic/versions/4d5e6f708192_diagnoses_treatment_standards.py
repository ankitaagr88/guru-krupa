"""diagnoses + treatment standards; prescriptions.diagnosis_id

Revision ID: 4d5e6f708192
Revises: 3c4d5e6f7081
"""
import sqlalchemy as sa
from alembic import op

revision = "4d5e6f708192"
down_revision = "3c4d5e6f7081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "diagnoses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "treatment_standards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("diagnosis_id", sa.Integer(), sa.ForeignKey("diagnoses.id"), nullable=False, unique=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
    )
    op.create_table(
        "treatment_standard_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("standard_id", sa.Integer(), sa.ForeignKey("treatment_standards.id"), nullable=False, index=True),
        sa.Column("medicine_id", sa.Integer(), sa.ForeignKey("medicines.id"), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("dosage", sa.Text(), nullable=False, server_default=""),
        sa.Column("qty_given", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    with op.batch_alter_table("prescriptions") as b:
        b.add_column(sa.Column("diagnosis_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_prescriptions_diagnosis_id_diagnoses", "diagnoses", ["diagnosis_id"], ["id"])
    op.create_index("ix_prescriptions_diagnosis_id", "prescriptions", ["diagnosis_id"])


def downgrade() -> None:
    op.drop_index("ix_prescriptions_diagnosis_id", table_name="prescriptions")
    with op.batch_alter_table("prescriptions") as b:
        b.drop_constraint("fk_prescriptions_diagnosis_id_diagnoses", type_="foreignkey")
        b.drop_column("diagnosis_id")
    op.drop_table("treatment_standard_lines")
    op.drop_table("treatment_standards")
    op.drop_table("diagnoses")
