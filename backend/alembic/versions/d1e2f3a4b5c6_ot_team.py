"""OT team: admin list of team roles (Surgeon, Anaesthetist... with a usual fee) and the directory of
outside doctors / partners. The team itself lives on each case in `ot_cases.billing` (JSON: team),
so no change to ot_cases. The starting roles are seeded by app.seed.ot_team.

Revision ID: d1e2f3a4b5c6
Revises: cf3a4b5c6d7e
"""
import sqlalchemy as sa
from alembic import op

revision = "d1e2f3a4b5c6"
down_revision = "cf3a4b5c6d7e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ot_team_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("default_fee", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "ot_partners",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("qualification", sa.String(120), nullable=False, server_default=""),
        sa.Column("reg_no", sa.String(60), nullable=False, server_default=""),
        sa.Column("phone", sa.String(20), nullable=False, server_default=""),
        sa.Column("default_role_key", sa.String(30), nullable=True),
        sa.Column("default_fee", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("note", sa.String(255), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ot_partners")
    op.drop_table("ot_team_roles")
