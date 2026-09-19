"""Shared fixtures: SQLite test DB, FastAPI test client, seeded admin user.

DATABASE_URL is forced to SQLite *before* app modules are imported so the engine in
app.db is created against the test file.
"""
import os
import pathlib

os.environ["DATABASE_URL"] = "sqlite:///./test.db"
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
    pathlib.Path("test.db").unlink(missing_ok=True)


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
