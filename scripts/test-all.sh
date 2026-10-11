#!/usr/bin/env bash
# Runs every automated check that works without a live Supabase/Google/Vercel account.
#   Optional tools: deno (Edge Function tests), POSTGREST_BIN (HTTP security probe), a Chromium
#   (browser smoke test: set E2E=1). Missing optional tools are reported as skipped, not passed.
set -uo pipefail
cd "$(dirname "$0")/.."
export NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://example.supabase.co}
export NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-anon-placeholder}
failed=(); skipped=()
run() { local name=$1; shift; echo; echo "=== $name"; if "$@"; then echo "--- $name: ok"; else echo "--- $name: FAILED"; failed+=("$name"); fi; }
skip() { echo; echo "=== $1: skipped ($2)"; skipped+=("$1"); }

if command -v psql >/dev/null; then run "SQL tests (schema, RLS, lifecycle, concurrency)" supabase/tests/run.sh; else skip "SQL tests" "psql not installed"; fi
if command -v psql >/dev/null; then
  run "Paste-in SQL (parts 1-6, plus start-over and re-apply) passes the same suite" bash -c 'RESET_ROUNDTRIP=1 USE_SETUP_SQL=1 TEST_DB=contest_setup supabase/tests/run.sh'
fi
run "Setup parts: skipped/repeated parts give plain messages" supabase/tests/setup_order.sh
run "Generated paste-in files are up to date" bash -c 'tmp=$(mktemp -d) && cp -r supabase/setup supabase/functions-dashboard "$tmp"/ && scripts/build-setup-sql.sh >/dev/null && node scripts/build-dashboard-functions.mjs >/dev/null && diff -r "$tmp/setup" supabase/setup && diff -r "$tmp/functions-dashboard" supabase/functions-dashboard'
if [ -n "${POSTGREST_BIN:-}" ]; then run "HTTP security probe (PostgREST)" supabase/tests/http/run.sh; else skip "HTTP security probe" "set POSTGREST_BIN"; fi
if command -v deno >/dev/null; then run "Edge Function tests (deno)" bash -c 'cd supabase/functions && deno test --allow-env --no-lock && deno check --no-lock */*.ts'; else skip "Edge Function tests" "deno not installed"; fi
run "Apps Script tests" bash -c 'cd apps-script && npm test'
run "Web: unit tests" bash -c 'cd web && npm test'
run "Web: lint" bash -c 'cd web && npx eslint .'
run "Web: type-check + production build" bash -c 'cd web && npx next build'
if [ "${E2E:-}" = "1" ]; then run "Web: browser smoke test (mock Supabase)" bash -c 'cd web/e2e && npm i --silent && node smoke.mjs'; else skip "Browser smoke test" "set E2E=1"; fi

echo; echo "================ summary"
[ ${#skipped[@]} -gt 0 ] && printf 'skipped: %s\n' "${skipped[@]}"
if [ ${#failed[@]} -gt 0 ]; then printf 'FAILED: %s\n' "${failed[@]}"; exit 1; fi
echo "all executed checks passed"
