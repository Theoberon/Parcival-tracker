#!/usr/bin/env bash
# Builds a fresh test database: Supabase shim -> migrations -> seed -> test helpers.
#   usage: build_db.sh <dbname>      (same connection rules as run.sh)
set -euo pipefail
cd "$(dirname "$0")"
DB=${1:?database name}
if [ -z "${PGHOST:-}" ] && [ "$(id -u)" = "0" ]; then
  P() { su postgres -c "psql -X -q -v ON_ERROR_STOP=1 $*"; }
  PF() { su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $1"; }
  chmod -R a+rX "$(cd .. && pwd)" 2>/dev/null || true
else
  P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
  PF() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
fi
P "-d postgres -c 'drop database if exists $DB' -c 'create database $DB'" >/dev/null
PF "$PWD/shim.sql" 2>&1 | grep -v -E "wal_level|HINT" || true
if [ "${USE_SETUP_SQL:-}" = "1" ]; then
  # exactly what the owner pastes into the Supabase SQL editor
  for f in ../setup/[1-6]-*.sql; do echo "applying supabase/setup/$(basename "$f")"; PF "$(realpath "$f")"; done
  if [ "${RESET_ROUNDTRIP:-}" = "1" ]; then
    # "start over" must remove everything it created, and the parts must then apply cleanly again
    echo "applying 0-start-over.sql, then the parts again"; PF "$(realpath ../setup/0-start-over.sql)"
    for f in ../setup/[1-6]-*.sql; do PF "$(realpath "$f")"; done
  fi
else
  for f in ../migrations/*.sql; do echo "migrate $(basename "$f")"; PF "$(realpath "$f")"; done
  PF "$(realpath ../seed.sql)"
fi
PF "$PWD/helpers.sql"
