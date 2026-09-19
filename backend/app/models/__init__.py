"""Import every model module here so Base.metadata and Alembic see all tables."""
from app.db import Base  # noqa: F401
from app.models.appointments import Appointment  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401
from app.models.billing import Bill, BillItem  # noqa: F401
from app.models.config import LensTier, ProtocolStep, ReferralSource, Stage  # noqa: F401
from app.models.dilation import DilationRun, DilationStep  # noqa: F401
from app.models.mr import MrVisit  # noqa: F401
from app.models.ot import OtCase, OtConsentPhoto  # noqa: F401
from app.models.patients import ExamPhoto, Patient, Visit  # noqa: F401
from app.models.pharmacy import InventoryItem, Medicine, Prescription, PrescriptionLine, StockMovement  # noqa: F401
from app.models.readings import Reading  # noqa: F401
from app.models.staff import Staff  # noqa: F401
