"""Housekeeping for cron on the VPS:

    python -m app.maintenance            # purge printout photos older than READING_IMAGE_RETENTION_DAYS
    python -m app.maintenance --days 3   # override the retention window

Machine-printout images are deleted as soon as a person approves the extracted values
(POST /readings/{id}/approve); this is the safety net for readings nobody approved."""
from __future__ import annotations

import argparse
import sys

from app.config import settings
from app.db import SessionLocal
from app.services.readings import purge_stale_images


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=settings.READING_IMAGE_RETENTION_DAYS,
                    help="delete images of done/failed readings captured more than this many days ago")
    args = ap.parse_args(argv)
    with SessionLocal() as db:
        n = purge_stale_images(db, args.days)
    print(f"purged {n} reading image(s) older than {args.days} day(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
