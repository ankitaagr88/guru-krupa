#!/usr/bin/env bash
# Routine release: pull, install deps if changed, migrate, build PWA, restart.
# Usage: sudo bash /srv/gurukrupa/deploy/deploy.sh [branch-or-tag]
set -euo pipefail

APP_USER=gurukrupa
APP_ROOT=/srv/gurukrupa
BACKEND="$APP_ROOT/backend"
FRONTEND="$APP_ROOT/frontend"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/health}"
REF="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2; exit 1
fi
as_app() { sudo -u "$APP_USER" HOME="$APP_ROOT" "$@"; }
step() { echo; echo "==> $*"; }

cd "$APP_ROOT"

step "Fetching code"
as_app git fetch --tags --prune
if [[ -n "$REF" ]]; then
  as_app git checkout --quiet "$REF"
  # If REF is a branch, fast-forward it; if a tag/commit (detached HEAD), leave as is.
  if as_app git symbolic-ref -q HEAD >/dev/null; then as_app git pull --ff-only; fi
else
  as_app git pull --ff-only
fi
echo "Now at: $(as_app git log -1 --format='%h %s (%cd)' --date=short)"

step "Backend dependencies"
HASH_FILE="$BACKEND/.venv/requirements.sha256"
NEW_HASH="$(sha256sum "$BACKEND/requirements.txt" | awk '{print $1}')"
OLD_HASH="$(cat "$HASH_FILE" 2>/dev/null || true)"
if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  echo "requirements.txt changed; running pip install"
  as_app "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
  echo "$NEW_HASH" | as_app tee "$HASH_FILE" >/dev/null
else
  echo "requirements.txt unchanged; skipping pip install"
fi

step "Database migrations (alembic upgrade head)"
(cd "$BACKEND" && as_app "$BACKEND/.venv/bin/alembic" upgrade head)

if [[ -f "$FRONTEND/package.json" ]]; then
  step "Frontend build"
  (cd "$FRONTEND" && as_app npm ci --no-audit --no-fund && as_app npm run build)
else
  step "No frontend/package.json yet; skipping frontend build"
fi

step "Restarting API"
systemctl restart gurukrupa-api

step "Reloading nginx"
nginx -t
systemctl reload nginx

step "Health check ($HEALTH_URL)"
for _ in $(seq 1 10); do
  if out="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
    echo "$out"; echo "Deploy OK."; exit 0
  fi
  sleep 1
done
echo "Health check FAILED after 10s. Recent logs:" >&2
journalctl -u gurukrupa-api -n 40 --no-pager >&2 || true
exit 1
