#!/usr/bin/env bash
# The numbered setup files must (a) run cleanly in order, (b) give a plain message when a part is
# skipped or repeated, never "relation does not exist". Each file is sent as ONE query, like the
# Supabase SQL editor does (the first error stops everything and rolls the file back).
set -uo pipefail
cd "$(dirname "$0")"
DB=contest_order; SETUP=$(cd ../setup && pwd)
if [ "$(id -u)" = "0" ] && [ -z "${PGHOST:-}" ]; then
  PSQL() { su postgres -c "psql -X -q $*"; }
else
  PSQL() { psql -X -q "$@"; }
fi
PSQL "-d postgres -c 'drop database if exists $DB' -c 'create database $DB'" >/dev/null
PSQL "-d $DB -f $PWD/shim.sql" >/dev/null 2>&1
fail=0
# expect <file> <expected text or "OK">
expect() {
  local out
  if [ "$(id -u)" = "0" ] && [ -z "${PGHOST:-}" ]; then
    out=$(su postgres -c "psql -X -q -d $DB -c \"\$(cat $SETUP/$1)\"" 2>&1 | grep -E "ERROR" | head -1)
  else
    out=$(psql -X -q -d "$DB" -c "$(cat "$SETUP/$1")" 2>&1 | grep -E "ERROR" | head -1)
  fi
  if [ "$2" = "OK" ]; then [ -z "$out" ] && echo "  ok    $1 runs cleanly" || { echo "  FAIL  $1 should run cleanly: $out"; fail=1; }
  else case "$out" in *"$2"*) echo "  ok    $1 -> \"$2\"";; *) echo "  FAIL  $1 expected \"$2\" but got: ${out:-<no error>}"; fail=1;; esac; fi
}
# 0-where-am-i.sql reports progress: all false at first, all true at the end
where() {
  if [ "$(id -u)" = "0" ] && [ -z "${PGHOST:-}" ]; then su postgres -c "psql -X -q -At -d $DB -f $SETUP/0-where-am-i.sql"; else psql -X -q -At -d "$DB" -f "$SETUP/0-where-am-i.sql"; fi
}
progress() { [ "$(where)" = "$1" ] && echo "  ok    0-where-am-i reports $1" || { echo "  FAIL  0-where-am-i expected $1 but got $(where)"; fail=1; }; }
progress "f|f|f|f|f|f"
for f in 2-functions 3-security 4-login-delay 5-titles 6-starting-data; do expect $f.sql "Start with part 1"; done
expect 1-schema.sql OK
progress "t|f|f|f|f|f"
expect 1-schema.sql "Part 1 was already run"
expect 3-security.sql "Run part 2"
expect 2-functions.sql OK
expect 2-functions.sql "Part 2 was already run"
expect 4-login-delay.sql "Run part 3"
expect 3-security.sql OK
expect 3-security.sql "Part 3 was already run"
expect 5-titles.sql "Run part 4"
expect 4-login-delay.sql OK
expect 4-login-delay.sql "Part 4 was already run"
expect 6-starting-data.sql "Run part 5"
expect 5-titles.sql OK
expect 5-titles.sql "Part 5 was already run"
expect 6-starting-data.sql OK
progress "t|t|t|t|t|t"
exit $fail
