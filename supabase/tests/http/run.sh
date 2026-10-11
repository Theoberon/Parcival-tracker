#!/usr/bin/env bash
# Runs probe.mjs against a real PostgREST (the API layer Supabase uses) on the local test database,
# with real signed JWTs. Needs the PostgREST binary:
#   https://github.com/PostgREST/postgrest/releases  (v12.x, linux-static-x64)
#   POSTGREST_BIN=/path/to/postgrest ./supabase/tests/http/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${POSTGREST_BIN:?set POSTGREST_BIN to the postgrest binary}
DB=contest_http; PORT=${PORT:-3001}; SECRET="probe-secret-probe-secret-probe-secret-123"
./build_db.sh "$DB" >/dev/null
if [ "$(id -u)" = "0" ] && [ -z "${PGHOST:-}" ]; then SQL() { su postgres -c "psql -X -q -A -t -v ON_ERROR_STOP=1 -d $DB"; }; else SQL() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB"; }; fi

SQL >/dev/null <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login password 'probe-pass'; end if; end $$;
grant anon, authenticated, service_role to authenticator;
select t.state_open();
SQL
read -r MEMBER OTHER ADMIN OWNER < <(SQL <<'SQL' | tr '|' ' '
select t.mk_member('m1@x.test','Maya') || '|' || t.mk_member('m2@x.test','Noor') || '|' || t.mk_admin('a@x.test') || '|' || t.mk_admin('o@x.test','owner');
SQL
)
SQL >/dev/null <<SQL
select t.mk_pending('$MEMBER', 'New Account', 'maya_one');
select t.mk_pending('$OTHER', 'New Gig', 'noor gig');
SQL

# Negative control: SABOTAGE_SQL='...' weakens the database on purpose; the probe must then fail.
if [ -n "${SABOTAGE_SQL:-}" ]; then echo "$SABOTAGE_SQL" | SQL >/dev/null; fi

PGRST_DB_URI="postgres://authenticator:probe-pass@127.0.0.1:5432/$DB" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=$PORT PGRST_LOG_LEVEL=error "$BIN" >/tmp/postgrest.log 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.25; done

ANON=$(node -e "
const c=require('crypto'),b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',exp:Math.floor(Date.now()/1000)+600});
console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))")
PROBE_URL="http://127.0.0.1:$PORT" PROBE_REST_PREFIX="" PROBE_ANON_KEY="$ANON" PROBE_JWT_SECRET="$SECRET" \
PROBE_MEMBER_ID="$MEMBER" PROBE_ADMIN_ID="$ADMIN" PROBE_OWNER_ID="$OWNER" node http/probe.mjs
