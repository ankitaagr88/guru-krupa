#!/usr/bin/env bash
# First-time bootstrap of a fresh Hostinger Ubuntu 22.04 / 24.04 VPS for the
# Gurukrupa Eye Hospital system. Safe to re-run (idempotent).
#
# Usage (as root):
#   sudo REPO_URL=https://github.com/<org>/gurukrupa-system.git \
#        PG_PASSWORD='...' DOMAIN=clinic.example.com bash deploy/setup-vps.sh
#
# Env vars (all optional):
#   REPO_URL     git remote to clone            (default: origin of the checkout this script runs from, else prompt)
#   BRANCH       branch to deploy               (default: main)
#   PG_PASSWORD  password for the Postgres role (prompted if unset)
#   DOMAIN       server_name for nginx          (default: leave clinic.example.com placeholder)
set -euo pipefail

APP_USER=gurukrupa
APP_ROOT=/srv/gurukrupa
BRANCH="${BRANCH:-main}"
DB_NAME=gurukrupa
DB_USER=gurukrupa
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

step() { echo; echo "==> $*"; }

# ---------------------------------------------------------------- packages
step "Installing apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx postgresql postgresql-contrib python3-pip git \
  tesseract-ocr libgl1 libglib2.0-0 certbot python3-certbot-nginx curl ca-certificates openssl

# Python: prefer 3.11 (docs say 3.11+). 22.04 ships 3.10, 24.04 ships 3.12;
# python3.11-venv is not in the default repos of either, so fall back to the
# system python3 (>= 3.10 is enough for the code base).
if apt-get install -y -q python3.11-venv python3.11-dev 2>/dev/null; then
  PYTHON=python3.11
else
  echo "python3.11-venv not available from apt; using system python3"
  apt-get install -y -q python3-venv python3-dev
  PYTHON=python3
fi
PYVER="$($PYTHON -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
echo "Using $PYTHON ($PYVER)"
if ! $PYTHON -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
  echo "Python >= 3.10 required (got $PYVER). Install python3.11 via deadsnakes and re-run." >&2
  exit 1
fi

# Node LTS for the frontend build (skipped if node >= 18 already present)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]]; then
  step "Installing Node.js 20 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -q nodejs
fi

# ---------------------------------------------------------------- user + dirs
step "Creating system user '$APP_USER' and $APP_ROOT layout"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_ROOT"/{uploads,backups}
chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
chmod 750 "$APP_ROOT" "$APP_ROOT/uploads"
# nginx (www-data) needs to traverse into frontend/dist and uploads/
usermod -aG "$APP_USER" www-data

# ---------------------------------------------------------------- postgres
step "Configuring PostgreSQL role '$DB_USER' and database '$DB_NAME'"
systemctl enable --now postgresql
if [[ -z "${PG_PASSWORD:-}" ]]; then
  read -r -s -p "Password for Postgres role '$DB_USER': " PG_PASSWORD; echo
  [[ -n "$PG_PASSWORD" ]] || { echo "Empty password, aborting" >&2; exit 1; }
fi
# escape single quotes for the SQL literal
PG_PASSWORD_SQL="${PG_PASSWORD//\'/\'\'}"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -qc "ALTER ROLE $DB_USER WITH PASSWORD '$PG_PASSWORD_SQL';"
else
  sudo -u postgres psql -qc "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$PG_PASSWORD_SQL';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# ---------------------------------------------------------------- repo
step "Cloning / updating repository"
if [[ ! -d "$APP_ROOT/.git" ]]; then
  if [[ -z "${REPO_URL:-}" ]]; then
    REPO_URL="$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || true)"
  fi
  if [[ -z "$REPO_URL" ]]; then
    read -r -p "Git repo URL to clone: " REPO_URL
  fi
  # $APP_ROOT already holds uploads/ and backups/, so clone to a temp dir and copy in.
  tmp="$(mktemp -d)"
  git clone --branch "$BRANCH" "$REPO_URL" "$tmp/repo"
  cp -a "$tmp/repo/." "$APP_ROOT/"
  rm -rf "$tmp"
  chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
else
  sudo -u "$APP_USER" git -C "$APP_ROOT" pull --ff-only
fi
git config --global --add safe.directory "$APP_ROOT" || true

# ---------------------------------------------------------------- backend
step "Creating virtualenv and installing Python requirements"
BACKEND="$APP_ROOT/backend"
if [[ ! -x "$BACKEND/.venv/bin/python" ]]; then
  sudo -u "$APP_USER" "$PYTHON" -m venv "$BACKEND/.venv"
fi
sudo -u "$APP_USER" HOME="$APP_ROOT" "$BACKEND/.venv/bin/pip" install -q --upgrade pip
sudo -u "$APP_USER" HOME="$APP_ROOT" "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
sha256sum "$BACKEND/requirements.txt" | awk '{print $1}' > "$BACKEND/.venv/requirements.sha256"
chown "$APP_USER:$APP_USER" "$BACKEND/.venv/requirements.sha256"

step "Preparing backend/.env"
if [[ ! -f "$BACKEND/.env" ]]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  SECRET="$(openssl rand -hex 32)"
  sed -i \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql+psycopg://$DB_USER:$PG_PASSWORD@localhost:5432/$DB_NAME|" \
    -e "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET|" \
    -e "s|^UPLOAD_DIR=.*|UPLOAD_DIR=$APP_ROOT/uploads|" \
    "$BACKEND/.env"
  # Same-origin behind nginx, so only the public domain needs to be in CORS.
  if [[ -n "${DOMAIN:-}" ]]; then
    echo "CORS_ORIGINS=[\"https://$DOMAIN\"]" >> "$BACKEND/.env"
  fi
  chmod 640 "$BACKEND/.env"
  chown "$APP_USER:$APP_USER" "$BACKEND/.env"
  echo "    Created $BACKEND/.env with a generated SECRET_KEY."
  echo "    >>> REVIEW $BACKEND/.env (SECRET_KEY, DATABASE_URL, CORS_ORIGINS) before going live. <<<"
else
  echo "    $BACKEND/.env already exists, leaving it alone."
  if grep -q 'replace-with-a-long-random-string' "$BACKEND/.env"; then
    echo "    >>> WARNING: SECRET_KEY in $BACKEND/.env is still the example value. Edit it! <<<"
  fi
fi

step "Running database migrations"
(cd "$BACKEND" && sudo -u "$APP_USER" HOME="$APP_ROOT" "$BACKEND/.venv/bin/alembic" upgrade head)

# ---------------------------------------------------------------- frontend
if [[ -f "$APP_ROOT/frontend/package.json" ]]; then
  step "Building frontend"
  (cd "$APP_ROOT/frontend" \
    && sudo -u "$APP_USER" HOME="$APP_ROOT" npm ci --no-audit --no-fund \
    && sudo -u "$APP_USER" HOME="$APP_ROOT" npm run build)
else
  step "frontend/package.json not present yet; skipping frontend build"
  mkdir -p "$APP_ROOT/frontend/dist"
  if [[ ! -f "$APP_ROOT/frontend/dist/index.html" ]]; then
    echo '<h1>Gurukrupa: frontend not built yet</h1>' > "$APP_ROOT/frontend/dist/index.html"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_ROOT/frontend"
fi

# ---------------------------------------------------------------- systemd + nginx
step "Installing systemd units"
cp "$APP_ROOT/deploy/gurukrupa-api.service"    /etc/systemd/system/gurukrupa-api.service
cp "$APP_ROOT/deploy/gurukrupa-backup.service" /etc/systemd/system/gurukrupa-backup.service
cp "$APP_ROOT/deploy/gurukrupa-backup.timer"   /etc/systemd/system/gurukrupa-backup.timer
systemctl daemon-reload
systemctl enable gurukrupa-api
systemctl restart gurukrupa-api
systemctl enable --now gurukrupa-backup.timer

step "Installing nginx site"
cp "$APP_ROOT/deploy/nginx-gurukrupa.conf" /etc/nginx/sites-available/gurukrupa
if [[ -n "${DOMAIN:-}" ]]; then
  sed -i "s/server_name clinic.example.com;/server_name $DOMAIN;/" /etc/nginx/sites-available/gurukrupa
fi
ln -sf /etc/nginx/sites-available/gurukrupa /etc/nginx/sites-enabled/gurukrupa
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ---------------------------------------------------------------- check
step "Health check"
sleep 2
if curl -fsS http://127.0.0.1/api/health; then
  echo; echo "API is up."
else
  echo; echo "Health check FAILED. See: journalctl -u gurukrupa-api -n 50" >&2
  exit 1
fi

echo
echo "Done. Next steps:"
echo "  1. Point DNS for your domain at this VPS."
echo "  2. sudo certbot --nginx -d ${DOMAIN:-clinic.example.com}"
echo "  3. Seed reference data + first admin: cd $BACKEND && sudo -u $APP_USER .venv/bin/python -m app.seed"
echo "  4. Routine releases: sudo bash $APP_ROOT/deploy/deploy.sh"
