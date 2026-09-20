"""Diagnoses and treatment standards (B15/F17).

A *treatment standard* is the prescription that auto-fills when the doctor picks a diagnosis:
the admin-saved one when there is one, otherwise the most common prescription across every
past prescription written for that diagnosis (pure counting — no AI).
"""
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


class DiagnosisIn(CamelModel):
    name: str = Field(min_length=1, max_length=160)


class DiagnosisPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    active: bool | None = None


class DiagnosisOut(CamelModel):
    id: int
    name: str
    active: bool
    sort_order: int
    prescription_count: int = 0  # past prescriptions written for it (the history the standard is counted from)
    has_standard: bool = False  # an admin-saved standard exists


class StandardLineIn(CamelModel):
    name: str = Field(min_length=1, max_length=160)
    medicine_id: int | None = None
    dosage: str = ""
    qty_given: int = Field(default=0, ge=0)


class StandardIn(CamelModel):
    lines: list[StandardLineIn] = []


class StandardLineOut(CamelModel):
    name: str
    medicine_id: int | None
    matched: bool
    dosage: str
    qty_given: int = 0
    frequency: float | None = None  # history only: share of past prescriptions that included it (0-1)


class StandardOut(CamelModel):
    """`GET /diagnoses/{id}/standard`: what the prescription screen fills in."""

    diagnosis_id: int
    diagnosis_name: str
    source: str  # "admin" | "history" | "none"
    lines: list[StandardLineOut]
    history_count: int  # past prescriptions for this diagnosis
    updated_at: datetime | None = None  # admin standard only
    updated_by: str | None = None
    # When an admin standard exists, the history-derived set is still returned so Admin can compare.
    history_lines: list[StandardLineOut] = []
