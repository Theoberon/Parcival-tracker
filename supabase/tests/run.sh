#!/usr/bin/env bash
# Runs the SQL test suite against a local Postgres 16 (needs a superuser connection).
#   PGHOST/PGPORT/PGUSER/PGPASSWORD are honoured; default is the local "postgres" cluster
#   via `su postgres`. Each run builds a fresh database: shim -> migrations -> seed -> tests.
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-contest_test}
if [ -z "${PGHOST:-}" ] && [ "$(id -u)" = "0" ]; then
  PF() { su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $1"; }
else
  PF() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
fi
./build_db.sh "$DB"
fail=0
for t in sql/*.sql; do
  echo "== $t"
  if ! PF "$PWD/$t"; then fail=1; echo "FAILED: $t"; fi
done
if [ -x ./concurrency.sh ]; then ./concurrency.sh "$DB" || fail=1; fi
[ $fail = 0 ] && echo "ALL SQL TESTS PASSED" || { echo "SQL TESTS FAILED"; exit 1; }
