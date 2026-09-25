"""`GET /patients/{id}/history` — everything the clinic holds on one patient, for the patient screen."""
from datetime import date, datetime

from app.schemas.appointments import AppointmentOut
from app.schemas.common import CamelModel
from app.schemas.ot import OtCaseOut
from app.schemas.patients import PatientOut
from app.schemas.billing import BillOut
from app.schemas.pharmacy import PrescriptionOut, PrintExamRow, PrintGlasses
from app.schemas.readings import ExamPhotoOut, ReadingOut


class VisitHistoryOut(CamelModel):
    id: int
    date: date
    token: str
    stage: str
    status: str
    va: dict[str, str]
    note: str
    doctor_notes: str
    elsewhere: bool
    elsewhere_note: str
    completed_at: datetime | None
    imported: bool = False  # came from the previous system (KiviHealth)
    readings: list[ReadingOut] = []
    prescription: PrescriptionOut | None = None
    bill: BillOut | None = None
    exam_photos: list[ExamPhotoOut] = []
    # As printed on the prescription: filled exam rows, and the glasses block (None = no glasses).
    exam: list[PrintExamRow] = []
    glasses: PrintGlasses | None = None


class PatientHistoryOut(CamelModel):
    patient: PatientOut
    visits: list[VisitHistoryOut]  # newest first
    ot_cases: list[OtCaseOut]  # newest first
    appointments: list[AppointmentOut]  # upcoming first, then past
    totals: dict[str, int]  # visits, prescriptions, surgeries, readings
