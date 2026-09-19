"""Role tuples for `require_role(*ROLE_TUPLE)`. Roles themselves live in app.models.staff.ROLES."""
from app.models.staff import ROLES

ANY_STAFF = ROLES
ADMIN_ONLY = ("admin",)
DOCTOR_ONLY = ("doctor",)
CLINICAL = ("doctor", "ot_staff")
FRONT_DESK = ("admin", "reception")

# Permission matrix (spec B1). Route modules import the tuples above; this dict is the
# single place that documents which tuple guards which feature.
PERMISSIONS: dict[str, tuple[str, ...]] = {
    "admin_config": ADMIN_ONLY,  # stages, protocol steps, staff, lens tiers, referral sources
    "ot_operative_notes": CLINICAL,  # OT operative / post-op notes
    "prescriptions": DOCTOR_ONLY,  # write prescriptions
    "queue_moves": ANY_STAFF,  # stage moves, VA, billing
    "inventory_adjust": FRONT_DESK,  # stock adjustments / receipts
    "mr_visits": FRONT_DESK,  # medical-rep visit log
}
