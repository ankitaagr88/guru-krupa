"""medicines: brand / composition / form / strength / pack_size / manufacturer; medicine_forms table

Revision ID: 2b3c4d5e6f70
Revises: 1a2b3c4d5e6f
"""
import sqlalchemy as sa
from alembic import op

revision = "2b3c4d5e6f70"
down_revision = "1a2b3c4d5e6f"
branch_labels = None
depends_on = None


# Seeded here too so the backfilled `form` keys below always resolve; app.seed.reference re-asserts them.
FORMS = [("drops", "Drops"), ("gel", "Gel"), ("ointment", "Ointment"), ("suspension", "Suspension"),
         ("tablet", "Tablet"), ("capsule", "Capsule"), ("syrup", "Syrup"), ("gummies", "Gummies")]


def upgrade() -> None:
    forms = op.create_table(
        "medicine_forms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.bulk_insert(forms, [{"key": k, "label": lbl, "sort_order": i, "active": True} for i, (k, lbl) in enumerate(FORMS)])

    with op.batch_alter_table("medicines") as b:
        b.add_column(sa.Column("brand", sa.String(length=120), nullable=True))
        b.add_column(sa.Column("composition", sa.Text(), nullable=True))
        b.add_column(sa.Column("form", sa.String(length=40), nullable=True))
        b.add_column(sa.Column("strength", sa.String(length=40), nullable=True))
        b.add_column(sa.Column("pack_size", sa.String(length=30), nullable=True))
        b.add_column(sa.Column("manufacturer", sa.String(length=120), nullable=True))

    # Backfill: existing rows are generic-only, so the name *is* the composition.
    op.execute("UPDATE medicines SET composition = name WHERE composition IS NULL")
    op.execute("UPDATE medicines SET form = 'ointment' WHERE form IS NULL AND LOWER(name) LIKE '%ointment%'")
    op.execute("UPDATE medicines SET form = 'tablet' WHERE form IS NULL AND LOWER(name) LIKE '%tablet%'")
    op.execute("UPDATE medicines SET form = 'gel' WHERE form IS NULL AND LOWER(name) LIKE '%gel%'")
    op.execute("UPDATE medicines SET form = 'drops' WHERE form IS NULL")
    op.execute("UPDATE medicines SET active = true WHERE active IS NULL")

    with op.batch_alter_table("medicines") as b:
        b.alter_column("composition", existing_type=sa.Text(), nullable=False)
        b.alter_column("form", existing_type=sa.String(length=40), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("medicines") as b:
        b.drop_column("manufacturer")
        b.drop_column("pack_size")
        b.drop_column("strength")
        b.drop_column("form")
        b.drop_column("composition")
        b.drop_column("brand")
    op.drop_table("medicine_forms")
