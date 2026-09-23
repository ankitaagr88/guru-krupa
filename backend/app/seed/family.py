"""Starting data for families on one mobile number: the relations list (lane E1 owns this module).
Called from `seed_reference`; must be idempotent."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.config import Relation

# A family member's relation to the owner of the shared number. Seeded once; afterwards Admin owns
# the list (rename, reorder, switch off, add more), so a re-seed never undoes those edits.
RELATIONS = [
    ("spouse", "Spouse"),
    ("son", "Son"),
    ("daughter", "Daughter"),
    ("father", "Father"),
    ("mother", "Mother"),
    ("brother", "Brother"),
    ("sister", "Sister"),
    ("grandson", "Grandson"),
    ("granddaughter", "Granddaughter"),
    ("grandfather", "Grandfather"),
    ("grandmother", "Grandmother"),
    ("son_in_law", "Son-in-law"),
    ("daughter_in_law", "Daughter-in-law"),
    ("other", "Other"),
]


def seed_family(db: Session) -> None:
    if db.scalar(select(Relation)) is not None:
        return
    for i, (key, label) in enumerate(RELATIONS):
        db.add(Relation(key=key, label=label, sort_order=i, active=True))
    db.flush()
