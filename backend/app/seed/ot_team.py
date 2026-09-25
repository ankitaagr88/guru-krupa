"""Starting OT team roles. Called from `seed_reference`; idempotent — once the list exists, Admin owns
it (rename, usual fee, order, switch off). Fees start at 0: the clinic sets them. No outside doctors
are seeded; the clinic adds them in Admin or from a case."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ot import OtTeamRole

SURGEON_KEY = "surgeon"

# (key, label)
OT_TEAM_ROLES = [
    (SURGEON_KEY, "Surgeon"),
    ("assistant_surgeon", "Assistant surgeon"),
    ("anaesthetist", "Anaesthetist"),
    ("scrub_nurse", "Scrub nurse"),
    ("ot_technician", "OT technician"),
]


def seed_ot_team(db: Session) -> None:
    if db.scalar(select(OtTeamRole)) is None:
        for i, (key, label) in enumerate(OT_TEAM_ROLES):
            db.add(OtTeamRole(key=key, label=label, default_fee=0, sort_order=i, active=True))
    db.flush()
