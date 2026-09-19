#!/usr/bin/env bash
# Nightly Postgres dump (custom format) + weekly tar of uploads/.
# Run by gurukrupa-backup.timer as root; can also be run by hand:
#   sudo bash /srv/gurukrupa/deploy/backup-db.sh
#   sudo FORCE_UPLOADS=1 bash /srv/gurukrupa/deploy/backup-db.sh   # also tar uploads now
set -euo pipefail

DB_NAME="${DB_NAME:-gurukrupa}"
BACKUP_DIR="${BACKUP_DIR:-/srv/gurukrupa/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/srv/gurukrupa/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"                    # daily DB dumps to keep
KEEP_UPLOAD_WEEKS="${KEEP_UPLOAD_WEEKS:-4}"     # weekly uploads tarballs to keep
TODAY="$(date +%Y%m%d)"

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

# ---- database ------------------------------------------------------------
DUMP="$BACKUP_DIR/gurukrupa-$TODAY.dump"
echo "==> pg_dump $DB_NAME -> $DUMP"
# Runs as the postgres superuser via peer auth, so no password is needed.
sudo -u postgres pg_dump -Fc --no-owner "$DB_NAME" > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"
chmod 640 "$DUMP"
ls -lh "$DUMP"

echo "==> pruning DB dumps older than $KEEP_DAYS days"
find "$BACKUP_DIR" -name 'gurukrupa-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete

# ---- uploads (weekly, Sundays) ------------------------------------------
# Trade-off: the DB dump is a few MB, but uploads/ (exam photos, machine
# printouts) grows by tens of MB per week and a full tar every night would
# quickly fill a small VPS disk. So it is tarred weekly and 4 copies are kept.
# If uploads outgrow the disk, switch to an incremental `rclone sync` of the
# directory instead of tarballs (see the off-box lines below).
if [[ "$(date +%u)" == "7" || "${FORCE_UPLOADS:-0}" == "1" ]]; then
  TAR="$BACKUP_DIR/uploads-$TODAY.tar.gz"
  echo "==> tar uploads -> $TAR"
  tar -czf "$TAR.tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  mv "$TAR.tmp" "$TAR"
  chmod 640 "$TAR"
  ls -lh "$TAR"
  find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -type f -mtime +"$((KEEP_UPLOAD_WEEKS * 7))" -print -delete
fi

# ---- off-box copy (recommended; the VPS disk is a single point of failure) --
# Pick ONE and uncomment. Configure the remote first (`rclone config` as root)
# or set up an ssh key for the target host.
# rclone copy "$BACKUP_DIR" gdrive:gurukrupa-backups --include 'gurukrupa-*.dump' --include 'uploads-*.tar.gz' --max-age 2d
# scp "$DUMP" backup@backup-host.example.com:/backups/gurukrupa/

echo "==> backup complete: $(du -sh "$BACKUP_DIR" | cut -f1) in $BACKUP_DIR"
