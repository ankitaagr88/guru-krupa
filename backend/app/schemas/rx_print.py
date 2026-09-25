"""Printed-prescription extras (lane R): a visit's examination findings and glasses prescription,
the admin lists behind them (exam findings, spectacle lens types) and the print settings.

Stored shapes (camelCase JSON on `Visit`):
  Visit.exam    = [{"key": "fundus", "r": "Normal", "l": "Normal"}, ...]   only rows with a value
  Visit.glasses = {"r": {"dist": {"sph": "-2.75", "cyl": "", "axis": "", "va": "6/6"},
                         "near": {"sph": "", "cyl": "", "axis": "", "va": "N6"}},
                   "l": {...same...}, "lensTypes": ["arc"], "ipd": "66", "note": ""}
                  or None when nothing is filled in (nothing prints).
Sph / Cyl are tidied to quarter-dioptre steps with a sign ("-2.5" -> "-2.50", "1" -> "+1.00",
"0" / "plano" -> "Plano"); Axis is a whole number 0-180; VA and the note are free text.
"""
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- glasses + exam on a visit
class LensValues(CamelModel):
    """One row (Dist or Near) for one eye. Empty string = not filled in."""

    model_config = CamelModel.model_config | {"coerce_numbers_to_str": True}  # -2.5 typed as a number
    sph: str = ""
    cyl: str = ""
    axis: str = ""
    va: str = ""


class EyeGlasses(CamelModel):
    dist: LensValues = LensValues()
    near: LensValues = LensValues()


class Glasses(CamelModel):
    model_config = CamelModel.model_config | {"coerce_numbers_to_str": True}
    r: EyeGlasses = EyeGlasses()
    l: EyeGlasses = EyeGlasses()  # noqa: E741  (the eye, as on the sheet)
    lens_types: list[str] = []  # LensType keys, in the order tapped
    ipd: str = ""  # millimetres, number only ("66", "63.5")
    note: str = ""


class ExamValue(CamelModel):
    model_config = CamelModel.model_config | {"coerce_numbers_to_str": True}  # IOP typed as 18
    key: str = Field(min_length=1, max_length=30)
    r: str = ""
    l: str = ""  # noqa: E741


class ExamRowOut(ExamValue):
    label: str


class ExamGlassesIn(CamelModel):
    exam: list[ExamValue] = []
    glasses: Glasses | None = None


class ReadingFill(CamelModel):
    """Values for "Fill from machine reading": the latest approved refraction reading of the visit
    (Sph / Cyl / Axis per eye, PD as IPD)."""

    reading_id: int
    machine: str
    captured_at: datetime | None = None
    r: LensValues
    l: LensValues  # noqa: E741
    ipd: str = ""


class IopFill(CamelModel):
    """IOP per eye from the visit's latest approved tonometer reading — the doctor's panel fills an
    empty IOP row of the examination with it."""

    reading_id: int
    machine: str
    r: str = ""
    l: str = ""  # noqa: E741


class ExamGlassesOut(CamelModel):
    visit_id: int
    exam: list[ExamRowOut]  # saved rows only, in the admin order
    glasses: Glasses | None
    from_reading: ReadingFill | None = None
    iop: IopFill | None = None
    va: dict[str, str] = {}  # the visit's Snellen VA {"r": "6/9", "l": "6/6"} (fills Dist VA)


# --------------------------------------------------------------------------- panel lists
class ExamFindingOut(CamelModel):
    id: int
    key: str
    label: str
    default_value: str
    sort_order: int
    active: bool


class LensTypeOut(CamelModel):
    id: int
    key: str
    label: str
    sort_order: int
    active: bool


class RxListsOut(CamelModel):
    exam_findings: list[ExamFindingOut]
    lens_types: list[LensTypeOut]


# --------------------------------------------------------------------------- admin
class ExamFindingIn(CamelModel):
    label: str = Field(min_length=1, max_length=80)
    default_value: str = Field(default="", max_length=80)
    key: str | None = Field(default=None, min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")


class ExamFindingPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    default_value: str | None = Field(default=None, max_length=80)
    active: bool | None = None


class LensTypeIn(CamelModel):
    label: str = Field(min_length=1, max_length=80)
    key: str | None = Field(default=None, min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")


class LensTypePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    active: bool | None = None


class KeyOrder(CamelModel):
    keys: list[str]


class FooterNote(CamelModel):
    english: str = Field(default="", max_length=300)
    hindi: str = Field(default="", max_length=300)
    gujarati: str = Field(default="", max_length=300)


class RxPrintSettings(CamelModel):
    """ClinicSetting "rx_print": printed under the hospital header and at the signature."""

    doctor_name: str = Field(default="", max_length=120)
    degrees: str = Field(default="", max_length=160)
    reg_no: str = Field(default="", max_length=60)
    footer_note: FooterNote = FooterNote()
