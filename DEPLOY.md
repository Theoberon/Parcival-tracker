# Deploying the Contest Scoreboard

Follow the steps in order. Steps marked **(you)** need your accounts; everything else is already in the repo.
Budget about 1.5 hours for a first deployment, then run the end-to-end test in section 8 before you share the Form link.

| Service | Used for | Plan notes |
|---|---|---|
| Supabase | Postgres, Auth, Storage, Edge Functions, Realtime | Free works for a small team. Free projects pause after a week of inactivity; screenshots are ≤ 500 KB each, so 1 GB holds about 2,000 of them. |
| Vercel | The Next.js website | Free (Hobby) is fine |
| Google (Form, Sheet, Apps Script) | Registration + emailing keys | A personal Gmail can send about 100 emails/day (every registration, key resend and rotation is one email) |

You do everything in web dashboards (Supabase, Vercel, Google). The Supabase CLI is not needed; the files you paste are in `supabase/setup/` and `supabase/functions-dashboard/`.

---

## 1. Supabase project (you)

### 1.1 Create the project
Create a project at supabase.com. From **Project Settings → API** save the **Project URL**, the **anon key** and the **service_role key**. Treat the service_role key like a password: it only ever goes into Apps Script and Supabase's own function code.

### 1.2 Create the database (SQL editor)
The setup is six numbered files in `supabase/setup/`. Run them **in order, one at a time**:

| # | File | What it creates |
|---|---|---|
| 1 | `1-schema.sql` | tables, rules that guard the data, audit log |
| 2 | `2-functions.sql` | the actions the site performs (approve, withdraw, standings …) |
| 3 | `3-security.sql` | who can read what, and the private `proofs` storage bucket |
| 4 | `4-login-delay.sql` | the growing delay after failed logins |
| 5 | `5-titles.sql` | contestant titles (admin-only) |
| 6 | `6-starting-data.sql` | the starting contest and its four categories |

For each file: **SQL Editor → New query**, copy the file, paste it, press **Run**. The whole file must arrive in one piece.

- **Copy reliably:** open the file on GitHub (branch `claude/build-plan-execution-j1yu7b`, folder `supabase/setup`) and use the **Copy raw file** button above the code (or open **Raw** and press Ctrl/Cmd+A, then Ctrl/Cmd+C). Do not copy from a scrolling code preview that only draws the lines currently on screen: it can silently copy just part of the file.
- **Check the paste:** the last line of every file reads `-- END OF PART N`. Press Ctrl/Cmd+End in the editor; if you do not land on that line, the paste is incomplete (clear the editor and copy again).
- A cut file fails with odd errors such as `syntax error at or near "new"` or `at or near "$$"`: they mean the editor received half a function.

You should see "Success. No rows returned" after each file.

Check at the end: **Table Editor** lists `contests`, `members`, `categories`, `submissions`, … and **Storage** shows a private bucket `proofs`. `select name, points from categories order by sort_order;` returns the four categories.

If the editor warns about "destructive operations", that is the `revoke` statements that lock the tables down: confirm and run.

**Not sure where you are?** Run `supabase/setup/0-where-am-i.sql` (it changes nothing). It shows `true` for each part that is already done; do the first `false` next.

**If a file fails:** each file starts with a safety check that stops with a plain sentence: "Run part N first" means you skipped a part, "Part N was already run" means continue with the next number. For any other error, copy the full message to me. Each file runs as a single request, so a failed file normally leaves nothing behind and you can run that same file again once it is fixed. If you ended up with a half-built database and no real data in it, run `0-start-over.sql` once (it removes everything this app created; read the note at its top) and begin again at file 1.

### 1.3 Auth settings (Authentication)
- **Sign In / Providers → Email:** turn **off** "Allow new users to sign up" (accounts are created only by Apps Script and admin invites).
- **Sessions:** **JWT expiry = 3600** seconds (1 hour). This is the longest a removed admin or banned member keeps API access (the database also checks their `active` flag on every request, so in practice access ends immediately).
- **URL Configuration:** **Site URL** = your Vercel URL (e.g. `https://contest.example.com`).
- **Password requirements:** leave the defaults (login keys are 12 uppercase letters/digits).
- **Email Templates:** paste `supabase/templates/invite.html` into **Invite user** and `supabase/templates/recovery.html` into **Reset password**.
- **SMTP Settings:** Supabase's built-in email only reaches your own team and is tightly rate limited. Configure a **custom SMTP provider** so admin invite/reset emails reach arbitrary addresses. (Member login keys are NOT sent by Supabase; Apps Script emails them.)
- **Failed-login delay (built in):** the website logs in through the `login` function, which counts failed attempts per email in the database. The 1st wrong try is free; the 2nd starts a 180-second (3-minute) cooldown, the 3rd means 4 minutes, the 4th 5 minutes, and so on up to 30 minutes. While waiting, even the correct key is refused, and a successful login resets the count. Counts older than 24 hours are forgotten. It applies the same way to admins and never reveals whether an email is registered. To change the numbers, edit the `_login_lock_seconds` function in `supabase/setup/4-login-delay.sql` before you run it.
  - This only covers people who log in through the website. Someone calling Supabase's login API directly is limited only by Supabase's own per-IP rate limits (**Authentication → Rate Limits**). On a **Teams/Enterprise** plan you can close that gap: **Authentication → Hooks → Password verification attempt** → Postgres function `public.hook_password_verification_attempt` applies the same delays to every login, and then add the function secret `LOGIN_THROTTLE_HOOK` = `on` so attempts are not counted twice.

### 1.4 Create yourself as the owner
1. **Authentication → Users → Add user → Create new user.** Your email + a strong password, tick **Auto Confirm User**.
2. **SQL Editor:** open `supabase/setup/7-create-owner.sql`, put your email in, Run. The result should list one row with role `owner`.

Other admins are invited later from the website (`/admin/admins`).

### 1.5 Deploy the seven Edge Functions (dashboard editor)
For each file in `supabase/functions-dashboard/`:
1. **Edge Functions → Deploy a new function → Via Editor.**
2. Name it exactly as the file (without `.ts`): `login`, `create-submission-draft`, `confirm-submission`, `cleanup-drafts`, `request-new-key`, `admin-manage`, `contest-export`. The website calls these names (including `login`: without it nobody can log in).
3. Replace the editor contents with the **whole file**, then **Deploy**.
4. Open the function's settings and switch **Verify JWT** (JWT enforcement) **off**. Each function checks its caller itself; the gateway check also breaks with Supabase's newer signing keys.

Each file is self-contained (no imports from other files), so the editor accepts it as is. The wording of buttons may differ slightly between dashboard versions.

When changing an Edge Function, edit its source under `supabase/functions/`, then run `node scripts/build-dashboard-functions.mjs` to regenerate `supabase/functions-dashboard/`. Redeploy the changed function by pasting its regenerated dashboard file; local source changes do not update the deployed function.

Then add the two secrets under **Edge Functions → Secrets** (after the Apps Script web app exists, section 4): `APPS_SCRIPT_URL` (the web app `/exec` URL) and `RESEND_SHARED_SECRET` (the same long random string as in Apps Script). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

### 1.6 Schedule the draft cleanup
1. **Database → Extensions:** enable `pg_cron` and `pg_net`.
2. **SQL Editor:** open `supabase/setup/8-schedule-cleanup.sql` and follow the two steps inside it (stores the service key in Vault, then schedules `cleanup-drafts` every 15 minutes).

### 1.7 Contest id for Apps Script
`select id, name from contests;` in the SQL editor. Copy the `id`.

## 2. Vercel (you)

1. Import the Git repository. **Root Directory: `web`**. Framework preset: Next.js.
2. Environment variables (Production **and** Preview), exactly these two and nothing else:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy, add your domain, and make sure it matches the Supabase **Site URL** from step 1.3.

## 3. Contest setup (you)

1. Log in at `/admin/login` as the owner → **Contest**: set the name, start, end and grace minutes.
2. **Categories**: the four starting categories are seeded. Check the point values and reference labels now: **point values lock when the contest starts** (the owner can unlock them later; this is logged).

## 4. Google Form, Sheet and Apps Script (you)

Follow [`apps-script/README.md`](apps-script/README.md). In short: build the Form (email collection on, response editing **off**, team access code validated, consent text), link it to a Sheet, paste the four `.gs` files, set the Script Properties, run `installTriggers`, deploy the web app ("Execute as me", "Anyone") and put its URL into the Supabase secret in step 1.6.

## 5. Secrets: where each one lives

| Secret | Lives in | Never in |
|---|---|---|
| Supabase service_role key | Apps Script Script Properties | Vercel, the Sheet, Git |
| Resend shared secret | Apps Script Script Properties + Supabase function secrets | Vercel, Git |
| Apps Script web app URL | Supabase function secrets | Vercel |
| Team access code | The Google Form validation | Git |
| Supabase anon key | Vercel env vars | (it is public by design) |

`.env*` files are git-ignored. After a build you can prove no secret leaked into the website bundle:
```bash
cd web
SUPABASE_SERVICE_ROLE_KEY=<value> RESEND_SHARED_SECRET=<value> npm run build   # build with the real values in the environment
SUPABASE_SERVICE_ROLE_KEY=<value> RESEND_SHARED_SECRET=<value> npm run check:bundle
```

## 6. Security pass on a staging project (Phase 7)

Do this against a **staging** Supabase project (a second project, same steps as above) with real data shapes, before launch:

```bash
PROBE_URL=https://<staging-ref>.supabase.co  PROBE_ANON_KEY=<staging anon key> \
PROBE_MEMBER_EMAIL=<a staging member>  PROBE_MEMBER_KEY=<their key> \
PROBE_ADMIN_EMAIL=<a non-owner admin>  PROBE_ADMIN_PASSWORD=<password> \
PROBE_OWNER_EMAIL=<owner>              PROBE_OWNER_PASSWORD=<password> \
node supabase/tests/http/probe.mjs
```
It checks (with real logins): logged-out visitors can read nothing and call nothing; a member sees only their own submissions and no other member's email, the audit log or admins and cannot call admin/owner functions; a normal admin cannot call owner functions; nobody can write tables directly; service-only functions are not callable; the leaderboard exposes no emails. Make sure the staging data has at least two members with submissions so the "only their own" checks are meaningful.

Then check by hand (cannot be automated without your real accounts):
- [ ] Storage: with a member's token, requesting a signed URL for **another member's** file path fails.
- [ ] Rotate a member's key (menu "Resend key for selected row"): the old key fails to log in, the new key works.
- [ ] Deactivate a member (untick **Active** in the Sheet, wait ≤ 10 min, or use the admin page): they are logged out within the hour at the latest and cannot log in.
- [ ] Remove a test admin on `/admin/admins`: same.
- [ ] The Apps Script `/exec` URL with a wrong or missing secret does nothing (returns `forbidden`).
- [ ] `delete from auth.sessions` works for the `postgres` role (the key-rotation helper `revoke_user_sessions` relies on it): run `select revoke_user_sessions('<a test user id>');` as service role and confirm their refresh stops working.

## 7. Day-to-day operations

| I want to… | Do this |
|---|---|
| Give a member a new key | Sheet menu **Contest → Resend key for selected row**, or the member uses **Resend my key** on the login page |
| Deactivate / reactivate a member | Untick/tick **Active** in the Sheet (applied within 10 min), or `/admin/members/<id>` (immediate) |
| Extend the deadline | `/admin/contest` → Extend. If the Form already closed, re-enable *Accepting responses* in the Form by hand |
| Fix an approval/rejection mistake | `/admin/members/<id>` → Reverse approval / Correct rejection / Grant override (each needs a reason and is logged) |
| End the contest | Review everything → `/admin/contest` → **Publish final results** (needs the grace period over and zero pending) |
| Fix something after publishing | **Reopen**, correct it, publish again. Members then see "Results updated" |
| Save results | `/admin/contest` → **Download CSVs** (standings + full audit log) |
| Clean up | **Archive** (≥ 30 days after publishing, only after an export): permanently deletes all screenshots |
| See what happened | `/admin/log` (filter by member, action, date) |
| Project the board | `/admin/board` |

## 8. Launch checklist (Phase 8)

- [ ] Supabase: sign-ups disabled, JWT expiry 3600, Site URL = Vercel domain, owner created, custom SMTP set, cleanup job scheduled
- [ ] Vercel: the two env vars set, production domain working over HTTPS
- [ ] Form: email collection on, response editing off, access-code validation, consent text, confirmation message
- [ ] Apps Script: Script Properties set, triggers installed (on form submit + every 10 minutes), web app deployed and its URL stored in the Supabase secret
- [ ] **End-to-end test with one real teammate** (not you): register through the Form → key arrives by email (check spam) → log in → submit a screenshot from their phone → you approve it → their points and rank update → "Resend my key" delivers a new key and the old one stops working
- [ ] Contest dates set; categories and points confirmed (they lock at the start time)
- [ ] Share the Form link

## 9. Troubleshooting

- **Key email did not arrive:** check the Sheet row: `Email status` and `Sync status`. `Failed…` rows are retried automatically every 10 minutes (a *new* key is issued, because the failed one was never delivered). Quota: menu "Emails left today".
- **Member is told "Too many failed attempts. Try again in N minutes.":** they have to wait. To clear it at once, run `delete from login_failures where email = 'their@email';` in the SQL editor (a correct login also clears it).
- **Member says "Email or key is incorrect":** the key is case/space/dash-insensitive, so it is usually an old key after a rotation, or the wrong email. Resend the key.
- **Screenshot upload fails on a phone:** the page keeps the draft and shows **Retry**; nothing is created twice. Files over 5 MB are refused before upload; larger photos are shrunk automatically.
- **Admin invite email never arrives:** custom SMTP is not configured (section 1.3) or the invite link template is missing.
- **`/admin` keeps sending me to the login page:** the account is not in the `admins` table (section 1.8), or it was removed.
