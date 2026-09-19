# Deployment runbook — Hostinger VPS (Ubuntu 22.04 / 24.04, Mumbai)

Everything lives under `/srv/gurukrupa` (a git checkout of this repo):

```
/srv/gurukrupa/
  backend/            FastAPI app, .venv/, .env      (uvicorn on 127.0.0.1:8000)
  frontend/dist/      built PWA served by Nginx
  uploads/            exam photos / printouts        (UPLOAD_DIR in .env)
  backups/            nightly pg_dump + weekly uploads tar
  deploy/             these files
```

Runs as the `gurukrupa` system user; Nginx fronts everything on 80/443.

| File | Purpose |
|---|---|
| `gurukrupa-api.service` | systemd unit for uvicorn (`--workers 2`) |
| `nginx-gurukrupa.conf` | `/api/` -> 8000, `/` -> PWA with SPA fallback, `/uploads/` internal (X-Accel-Redirect) |
| `setup-vps.sh` | first-time bootstrap (idempotent) |
| `deploy.sh` | routine release |
| `backup-db.sh` + `gurukrupa-backup.{service,timer}` | nightly backup at 02:30 |

## First-time setup

1. SSH in as root. Clone the repo anywhere temporary (or scp just `deploy/setup-vps.sh`).
2. Run the bootstrap:
   ```bash
   sudo REPO_URL=https://github.com/<org>/gurukrupa-system.git \
        PG_PASSWORD='choose-a-strong-password' \
        DOMAIN=clinic.example.com \
        bash deploy/setup-vps.sh
   ```
   It installs Nginx / Postgres / Python / Tesseract / Node / certbot, creates the
   `gurukrupa` user and DB, clones the repo to `/srv/gurukrupa`, builds the venv,
   writes `backend/.env` (generated `SECRET_KEY`, correct `DATABASE_URL` and
   `UPLOAD_DIR`), runs migrations, builds the frontend, installs the systemd
   units and the Nginx site, and curls `/api/health`.
3. Review `/srv/gurukrupa/backend/.env` (SECRET_KEY, CORS_ORIGINS).
4. Point DNS at the VPS, then get a certificate (certbot edits the Nginx file itself):
   ```bash
   sudo certbot --nginx -d clinic.example.com
   ```
5. Seed reference data and the first admin user:
   ```bash
   cd /srv/gurukrupa/backend && sudo -u gurukrupa .venv/bin/python -m app.seed
   ```
6. Set up the off-box backup copy: uncomment the `rclone` or `scp` line in
   `backup-db.sh` and configure the remote (`sudo rclone config`).

## Routine deploy

```bash
sudo bash /srv/gurukrupa/deploy/deploy.sh            # latest on current branch
sudo bash /srv/gurukrupa/deploy/deploy.sh v1.4.0     # a specific tag
```

Steps: `git pull --ff-only` -> `pip install` (only if `requirements.txt` hash
changed) -> `alembic upgrade head` -> `npm ci && npm run build` -> restart
`gurukrupa-api` -> `nginx -t && reload` -> curl `/api/health` (non-zero exit on
failure, prints the last 40 journal lines).

Tag releases (`git tag v1.4.0 && git push --tags`) so rollback has something to
aim at.

## Rollback

```bash
sudo bash /srv/gurukrupa/deploy/deploy.sh v1.3.0     # checks out the tag, rebuilds, restarts
```

Caveat: `deploy.sh` always runs `alembic upgrade head`, which is a no-op when
going back in code because the DB is already *ahead*. If the newer release
added a migration that the older code cannot live with, downgrade the schema
**before** rolling back the code:

```bash
cd /srv/gurukrupa/backend
sudo -u gurukrupa .venv/bin/alembic history | head          # find the revision
sudo -u gurukrupa .venv/bin/alembic downgrade -1             # one step back (or a revision id)
```

Downgrades that drop columns/tables lose data. Take a backup first
(`sudo systemctl start gurukrupa-backup`), and prefer a forward-fix when the
migration is additive.

## Logs

```bash
journalctl -u gurukrupa-api -f                 # API (uvicorn) live
journalctl -u gurukrupa-api -n 200 --no-pager  # last 200 lines
journalctl -u gurukrupa-backup                 # backup runs
tail -f /var/log/nginx/gurukrupa.access.log /var/log/nginx/gurukrupa.error.log
systemctl status gurukrupa-api nginx postgresql
systemctl list-timers gurukrupa-backup.timer
```

## Backups

Nightly at 02:30 (`gurukrupa-backup.timer`): `pg_dump -Fc` to
`/srv/gurukrupa/backups/gurukrupa-YYYYMMDD.dump`, 14 days kept. On Sundays it
also tars `uploads/` to `uploads-YYYYMMDD.tar.gz` (4 weeks kept). Run by hand
with `sudo systemctl start gurukrupa-backup` or
`sudo FORCE_UPLOADS=1 bash /srv/gurukrupa/deploy/backup-db.sh`.

### Restore the database

```bash
sudo systemctl stop gurukrupa-api
sudo -u postgres dropdb gurukrupa
sudo -u postgres createdb -O gurukrupa gurukrupa
sudo -u postgres pg_restore -d gurukrupa --no-owner --role=gurukrupa \
     /srv/gurukrupa/backups/gurukrupa-20260918.dump
sudo systemctl start gurukrupa-api
curl -s http://127.0.0.1/api/health
```

(To restore side-by-side instead, `createdb gurukrupa_restore` and point
`DATABASE_URL` at it temporarily.)

### Restore uploads

```bash
sudo systemctl stop gurukrupa-api
sudo tar -xzf /srv/gurukrupa/backups/uploads-20260914.tar.gz -C /srv/gurukrupa
sudo chown -R gurukrupa:gurukrupa /srv/gurukrupa/uploads
sudo systemctl start gurukrupa-api
```

## Notes for backend developers

- Protected file downloads: respond with an empty body and the header
  `X-Accel-Redirect: /uploads/<path relative to UPLOAD_DIR>` after the auth
  check; Nginx serves the file from `/srv/gurukrupa/uploads` (the location is
  `internal`, so browsers cannot hit it directly).
- Uploads over 25 MB are rejected by Nginx (`client_max_body_size`).
- OCR requests get a 120 s proxy timeout.
- The service runs with `ProtectSystem=full`; only `backend/` and `uploads/`
  are writable. Write temp files under `/tmp` (PrivateTmp) or `uploads/`.
