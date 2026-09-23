"""Starting data for visit fees: Dr Anu's fee list, visit kinds and the fee rules (lane E2 owns
this module). Called from `seed_reference`; must be idempotent."""
from sqlalchemy.orm import Session


def seed_fees(db: Session) -> None:
    pass
