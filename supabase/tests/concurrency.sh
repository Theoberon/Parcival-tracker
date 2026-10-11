#!/usr/bin/env bash
# Two admins approve the same submission at the same moment: points must be awarded exactly once.
# Uses real concurrent sessions (committed data), so it runs after the rolled-back SQL tests.
set -euo pipefail
DB=${1:-contest_test}
if [ -z "${PGHOST:-}" ] && [ "$(id -u)" = "0" ]; then
  PSQL() { su postgres -c "psql -X -q -A -t -v ON_ERROR_STOP=1 -d $DB"; }
else
  PSQL() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB"; }
fi
OUT=$(mktemp -d); chmod 777 "$OUT"

PSQL >/dev/null <<'SQL'
select t.state_open();
select t.mk_admin('c-adm1@x.test');
select t.mk_admin('c-adm2@x.test');
select t.mk_member('c-m@x.test', 'Concurrent');
SQL
M=$(echo "select id from members where email='c-m@x.test'" | PSQL)
A1=$(echo "select id from admins where email='c-adm1@x.test'" | PSQL)
A2=$(echo "select id from admins where email='c-adm2@x.test'" | PSQL)
S=$(echo "select t.mk_pending('$M', 'Converted Message / Order', 'FO-RACE')" | PSQL)

run() { # $1 admin id, $2 seconds to hold the transaction open after approving, $3 output file
  PSQL >"$3" 2>&1 <<SQL || true
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '$1', true);
set local role authenticated;
select approve_submission('$S');
select pg_sleep($2);
commit;
SQL
}
run "$A1" 2 "$OUT/a1.txt" & P1=$!
sleep 0.7           # admin 2 starts while admin 1 still holds the row lock
run "$A2" 0 "$OUT/a2.txt" & P2=$!
wait $P1 $P2
sed 's/^/  session: /' "$OUT/a1.txt" "$OUT/a2.txt"
REJECTED=$(cat "$OUT/a1.txt" "$OUT/a2.txt" | grep -c "already_reviewed" || true)
PTS=$(echo "select coalesce(sum(points_awarded),0) from submissions where member_id='$M' and status='approved'" | PSQL)
N=$(echo "select count(*) from audit_log where entity_id='$S' and action='submission.approved'" | PSQL)
echo "  already_reviewed errors: $REJECTED, points awarded: $PTS, approval audit rows: $N"
if [ "$REJECTED" = "1" ] && [ "$PTS" = "5" ] && [ "$N" = "1" ]; then echo "== concurrency: PASSED"; else echo "== concurrency: FAILED"; exit 1; fi
