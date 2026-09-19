"""Local upload storage: UPLOAD_DIR/<yyyy>/<mm>/<uuid>.<ext>. The DB stores the relative path;
the API serves it via GET /uploads/{path} (FileResponse in dev, X-Accel-Redirect behind Nginx)."""
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from fastapi import UploadFile

from app.config import settings

ALLOWED_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_BYTES = 25 * 1024 * 1024
_CHUNK = 1024 * 1024


class UploadError(Exception):
    pass


class UnsupportedType(UploadError):
    pass


class TooLarge(UploadError):
    pass


def upload_root() -> Path:
    return Path(settings.UPLOAD_DIR).resolve()


def abs_path(rel: str) -> Path:
    """Resolve a stored relative path, refusing anything that escapes UPLOAD_DIR."""
    root = upload_root()
    full = (root / PurePosixPath(rel)).resolve()
    if root != full and root not in full.parents:
        raise UploadError(f"path escapes upload dir: {rel}")
    return full


def public_url(rel: str | None) -> str | None:
    return f"/api/uploads/{rel}" if rel else None


def save_upload(file: UploadFile, *, now: datetime | None = None) -> str:
    """Stream the file to disk; returns the relative POSIX path ("2026/09/<uuid>.jpg")."""
    ext = ALLOWED_TYPES.get((file.content_type or "").split(";")[0].strip().lower())
    if ext is None:
        raise UnsupportedType(file.content_type or "unknown")
    now = now or datetime.now(timezone.utc)
    rel = PurePosixPath(f"{now:%Y}") / f"{now:%m}" / f"{uuid.uuid4().hex}.{ext}"
    dest = upload_root() / Path(rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := file.file.read(_CHUNK):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise TooLarge(size)
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return str(rel)


def delete_upload(rel: str | None) -> None:
    if not rel:
        return
    try:
        abs_path(rel).unlink(missing_ok=True)
    except (UploadError, OSError):
        pass


def move_into_uploads(src: Path, ext: str) -> str:
    """Used by tests/tools to register an existing file; mirrors save_upload's layout."""
    now = datetime.now(timezone.utc)
    rel = PurePosixPath(f"{now:%Y}") / f"{now:%m}" / f"{uuid.uuid4().hex}.{ext}"
    dest = upload_root() / Path(rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    return str(rel)
