from fastapi import APIRouter, Depends

from app.auth.deps import require_role
from app.auth.security import create_access_token
from app.auth.service import ensure_user
from app.main import app

_t = APIRouter(prefix="/_test_auth")


@_t.get("/admin-only", dependencies=[Depends(require_role("admin"))])
def _admin_only():
    return {"ok": True}


app.include_router(_t, prefix="/api")


def test_login_ok(client, admin_user):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["token_type"] == "bearer"
    assert body["user"]["username"] == "admin" and body["user"]["role"] == "admin"
    assert "password_hash" not in body["user"]


def test_login_form_encoded(client, admin_user):
    r = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text


def test_login_wrong_password(client, admin_user):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_login_inactive_user(client, db):
    u = ensure_user(db, username="gone", password="pw", name="Gone", role="reception")
    u.active = False
    db.commit()
    r = client.post("/api/auth/login", json={"username": "gone", "password": "pw"})
    assert r.status_code == 401
    token = create_access_token(str(u.id), u.role)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_me(client, admin_headers):
    r = client.get("/api/auth/me", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_me_no_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_expired_token(client, admin_user):
    token = create_access_token(str(admin_user.id), admin_user.role, expires_min=-1)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_garbage_token(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


def test_role_denied(client, db, admin_headers):
    ensure_user(db, username="recep", password="pw", name="Recep", role="reception")
    r = client.post("/api/auth/login", json={"username": "recep", "password": "pw"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/_test_auth/admin-only", headers=headers).status_code == 403
    assert client.get("/api/_test_auth/admin-only", headers=admin_headers).status_code == 200


def test_ensure_user_idempotent(db, admin_user):
    again = ensure_user(db, username="admin", password="other", name="X", role="reception")
    assert again.id == admin_user.id and again.role == "admin"
