"""Starting data for families on one mobile number: the relations list (lane E1 owns this module).
Called from `seed_reference`; must be idempotent."""
from sqlalchemy.orm import Session


def seed_family(db: Session) -> None:
    pass
