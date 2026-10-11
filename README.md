# Contest Scoreboard

Private contest platform: Google Form registration → Apps Script issues a login key →
members submit screenshot proof on a Next.js site → admins review → leaderboard.

The full specification is in [BUILD_PLAN.md](BUILD_PLAN.md). Deployment steps are in
[DEPLOY.md](DEPLOY.md).

| Folder | What |
|---|---|
| `supabase/` | Postgres migrations, Edge Functions, seed, SQL tests. **No CLI needed:** paste `setup/*.sql` into the SQL editor and `functions-dashboard/*.ts` into the Edge Functions editor (see DEPLOY.md) |
| `apps-script/` | Google Apps Script (registration, key issuing, resend endpoint) |
| `web/` | Next.js app (Vercel) |

## Preview on your computer

Needs Node 20+ and Git.

```bash
git clone https://github.com/Theoberon/Parcival-tracker && cd Parcival-tracker
git checkout claude/build-plan-execution-j1yu7b
cd web && npm install
npm run preview        # sample data, no Supabase needed -> http://localhost:3000
```
The terminal prints sample logins for a member, an admin and the owner. Nothing is saved.

To run against your real Supabase project instead, create `web/.env.local` from `web/.env.example`
(project URL + anon key) and run `npm run dev`.

## Tests

```bash
scripts/test-all.sh                      # everything below that your machine can run
POSTGREST_BIN=/path/to/postgrest E2E=1 scripts/test-all.sh   # + HTTP security probe + browser smoke test
```

| Suite | What it proves | Needs |
|---|---|---|
| `supabase/tests/run.sh` | Schema, rules, audit log, leaderboard, RLS privilege matrix, contest lifecycle, concurrent approvals. Runs the real migrations on a local Postgres with a thin shim of Supabase's `auth`/`storage` schemas | Postgres 16 (`psql`) |
| `supabase/tests/http/run.sh` | The same security rules over HTTP through a real PostgREST with signed JWTs (`probe.mjs` also runs against a staging project: see DEPLOY.md §6) | PostgREST binary |
| `supabase/functions` (`deno test`) | Edge Function handlers against fake clients | Deno |
| `apps-script` (`npm test`) | The real `.gs` files against fakes of Sheets/Mail/Form and of Supabase | Node |
| `web` (`npm test`, `eslint`, `next build`) | Key normalization, lint, types, production build | Node |
| `web/e2e` (`node smoke.mjs`) | Browser walkthrough of member + admin screens against a mock of the Supabase APIs | Chromium |

None of these talk to a real Supabase project, Google account or Vercel; see DEPLOY.md for the checks
you must do once on your own accounts.
