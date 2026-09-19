# Backend — Gurukrupa Eye Hospital API

FastAPI + SQLAlchemy 2 + Alembic. Postgres in dev/prod, SQLite in tests.

## Run locally
    python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
    copy .env.example .env         # edit DATABASE_URL / SECRET_KEY
    docker compose -f ../docker-compose.yml up -d   # Postgres 15
    .venv\Scripts\alembic upgrade head
    .venv\Scripts\python -m app.seed               # reference data + first admin
    .venv\Scripts\uvicorn app.main:app --reload    # http://localhost:8000/docs

## Tests
    .venv\Scripts\pytest -q

## Conventions
- One route module per feature in `app/routes/`, each calling `register(router)`.
- One model module per feature in `app/models/`, imported in `app/models/__init__.py`.
- Pydantic schemas in `app/schemas/`, mirroring the mockup's field names (camelCase in JSON via alias).
- JSON columns use `app.db.PortableJSON` (JSONB on Postgres, JSON on SQLite).
- Timestamps are timezone-aware UTC (`app.db.utcnow`).
- Auth: `Depends(get_current_user)` / `Depends(require_role("admin", ...))` from `app.auth.deps`.
