#!/bin/sh
set -eu

: "${PGPASSWORD:?POSTGRES_PASSWORD must be set}"
: "${PGHOST:?PGHOST must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${BACKUP_RETENTION_DAYS:=14}"

mkdir -p /backups

while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  temporary="/backups/axylum-${stamp}.dump.tmp"
  final="/backups/axylum-${stamp}.dump"
  if pg_dump --format=custom --no-owner --no-acl --file="$temporary" && pg_restore --list "$temporary" >/dev/null; then
    mv "$temporary" "$final"
    find /backups -type f -name 'axylum-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
    echo "[backup] completed ${final}"
    sleep 86400
  else
    rm -f "$temporary"
    echo "[backup] backup creation or validation failed" >&2
    sleep 3600
  fi
done
