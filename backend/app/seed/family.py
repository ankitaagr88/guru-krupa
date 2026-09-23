"""Starting data for families on one mobile number: the relations list (lane E1 owns this module).
Called from `seed_reference`; must be idempotent."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.config import Relation

# A family member's relation to the owner of the shared number, in Hindi with the English in brackets. Seeded once; afterwards Admin owns
# the list (rename, reorder, switch off, add more), so a re-seed never undoes those edits.
RELATIONS = [
    ("husband", "पति (Husband)"),
    ("wife", "पत्नी (Wife)"),
    ("son", "बेटा (Son)"),
    ("daughter", "बेटी (Daughter)"),
    ("father", "पिता (Father)"),
    ("mother", "माता (Mother)"),
    ("brother", "भाई (Brother)"),
    ("sister", "बहन (Sister)"),
    ("grandson", "पोता / नाती (Grandson)"),
    ("granddaughter", "पोती / नातिन (Granddaughter)"),
    ("grandfather", "दादा / नाना (Grandfather)"),
    ("grandmother", "दादी / नानी (Grandmother)"),
    ("son_in_law", "दामाद (Son-in-law)"),
    ("daughter_in_law", "बहू (Daughter-in-law)"),
    ("other", "अन्य (Other)"),
]


def seed_family(db: Session) -> None:
    if db.scalar(select(Relation)) is not None:
        return
    for i, (key, label) in enumerate(RELATIONS):
        db.add(Relation(key=key, label=label, sort_order=i, active=True))
    db.flush()
