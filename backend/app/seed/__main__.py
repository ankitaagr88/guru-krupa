"""`python -m app.seed` — reference tables + first admin user. Safe to re-run."""
import os

from app.db import SessionLocal
import app.models  # noqa: F401
from app.seed.reference import seed_reference


def main() -> None:
    db = SessionLocal()
    try:
        seed_reference(db)
        print("Reference data seeded.")
        try:
            from app.auth.service import ensure_user
        except ImportError:
            print("app.auth.service.ensure_user not available yet - skipping admin user. "
                  "Re-run `python -m app.seed` once the auth module is in place.")
            return
        ensure_user(db, username="admin", password=os.environ.get("ADMIN_PASSWORD", "admin123"),
                    name="Admin", role="admin")
        db.commit()
        print("Admin user ensured (username: admin).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
