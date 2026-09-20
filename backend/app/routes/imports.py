"""Spreadsheet import (B13/F15), admin-only.

  GET  /admin/import/targets          what can be imported and which columns each needs
  POST /admin/import/files            multipart `file` (CSV / Excel) -> token, headers, sample rows, suggested matching
  POST /admin/import/preview          {token, target, mapping} -> every row judged, nothing written
  POST /admin/import/run              same body -> written in one go, audited
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.common import CamelModel
from app.services import imports as svc

router = register(APIRouter(prefix="/admin/import", tags=["import"], dependencies=[Depends(get_current_user)]))
admin_user = Depends(require_role(*ADMIN_ONLY))
MAX_BYTES = 25 * 1024 * 1024


class ImportFileOut(CamelModel):
    token: str
    filename: str
    headers: list[str]
    row_count: int
    sample: list[list[str]]
    suggested: dict[str, dict[str, str]]  # target -> field -> header


class ImportBody(CamelModel):
    token: str = Field(min_length=32, max_length=32)
    target: str
    mapping: dict[str, str] = {}


class RowOut(CamelModel):
    row: int
    action: str
    label: str
    reason: str = ""


class ImportResultOut(CamelModel):
    target: str
    total: int
    new: int
    update: int
    skip: int
    written: bool
    rows: list[RowOut]
    warnings: list[str] = []


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("/targets")
def targets(user: Staff = admin_user):
    return svc.targets_out()


@router.post("/files", response_model=ImportFileOut)
async def upload(file: UploadFile = File(...), user: Staff = admin_user):
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 25 MB)")
    try:
        token = svc.store_file(data, file.filename or "upload.csv")
        headers, rows = svc.parse_table(data, file.filename or "upload.csv")
    except svc.ImportError_ as exc:
        raise _bad(exc) from exc
    return ImportFileOut(token=token, filename=file.filename or "", headers=headers, row_count=len(rows),
                         sample=rows[: svc.SAMPLE_ROWS],
                         suggested={t: svc.suggest_mapping(headers, t) for t in svc.TARGETS})


def _run(body: ImportBody, db: Session, user: Staff, write: bool) -> ImportResultOut:
    try:
        r = svc.run_import(db, body.token, body.target, body.mapping, user, write)
    except svc.ImportError_ as exc:
        raise _bad(exc) from exc
    return ImportResultOut(target=r.target, total=r.total, new=r.new, update=r.update, skip=r.skip, written=r.written,
                           rows=[RowOut(row=x.row, action=x.action, label=x.label, reason=x.reason) for x in r.rows],
                           warnings=r.warnings)


@router.post("/preview", response_model=ImportResultOut)
def preview(body: ImportBody, db: Session = Depends(get_db), user: Staff = admin_user):
    return _run(body, db, user, write=False)


@router.post("/run", response_model=ImportResultOut)
def run(body: ImportBody, db: Session = Depends(get_db), user: Staff = admin_user):
    return _run(body, db, user, write=True)
