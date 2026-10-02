"""Several diagnoses per visit: visits.diagnosis_ids and prescriptions.diagnosis_ids (ordered lists;
`diagnosis_id` stays as the first). Existing single diagnoses become one-item lists. The limit per
visit is ClinicSetting "diagnoses" (maxPerVisit, default 3) — no row needed.

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
"""
import sqlalchemy as sa
from alembic import op

revision = "f3a4b5c6d7e8"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def _json():
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    for table in ("visits", "prescriptions"):
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column("diagnosis_ids", _json(), nullable=False, server_default="[]"))
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in ("visits", "prescriptions"):
            op.execute(f"UPDATE {table} SET diagnosis_ids = jsonb_build_array(diagnosis_id) "
                       f"WHERE diagnosis_id IS NOT NULL")
    else:
        for table in ("visits", "prescriptions"):
            op.execute(f"UPDATE {table} SET diagnosis_ids = json_array(diagnosis_id) WHERE diagnosis_id IS NOT NULL")


def downgrade() -> None:
    for table in ("visits", "prescriptions"):
        with op.batch_alter_table(table) as b:
            b.drop_column("diagnosis_ids")
