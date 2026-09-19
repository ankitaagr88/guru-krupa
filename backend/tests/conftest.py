"""Shared fixtures: SQLite test DB, FastAPI test client, seeded admin user.

DATABASE_URL is forced to SQLite *before* app modules are imported so the engine in
app.db is created against the test file.
"""
import os
import pathlib
import tempfile

# Per-process DB file so parallel pytest runs (or several agents) never share state.
_TEST_DB = pathlib.Path(tempfile.gettempdir()) / f"gurukrupa-test-{os.getpid()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
os.environ["SECRET_KEY"] = "test-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
import app.models  # noqa: E402,F401  (registers all tables)
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    _TEST_DB.unlink(missing_ok=True)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_user(db):
    """First admin staff user, created via the auth module's helper (see app.auth)."""
    from app.auth.service import ensure_user

    return ensure_user(db, username="admin", password="admin123", name="Admin", role="admin")


@pytest.fixture
def admin_headers(client, admin_user):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
