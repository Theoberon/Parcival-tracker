# Contest Scoreboard — Build Plan

Hand-off document for Claude Code. Read this whole file before writing any code. Build phase by phase, in order, and do not start a phase until the previous phase's acceptance checks pass.

---

## 1. What we are building

A private contest platform for a freelancing team. Members register through a Google Form, receive a personal login key by email, log in to a website, and submit screenshot proof of completed Fiverr activity. Admins verify each submission. Approved submissions add points to a leaderboard that is visible only to logged-in members and admins.

The goal is to remove the manual work of collecting screenshots in group chats, checking them by hand, and updating a spreadsheet.

### Fixed decisions (do not change without asking the owner)

| Area | Decision |
|---|---|
| Registration | Google Form → Google Sheet. Open for the whole contest. Closes automatically when the contest closes. |
| Registration gate | Team access code question with exact-match response validation in the Form |
| Key delivery | Email, sent by Apps Script |
| Key issuer | Apps Script is the only component that creates or rotates keys |
| Sheet → backend | Apps Script calls Supabase directly (no n8n) |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) |
| Website | Next.js on Vercel |
| Member login | Email + key |
| Admin login | Email + password via Supabase Auth, invite only, no 2FA |
| Admin count | Unlimited. Owner role can add/remove admins; admins cannot. |
| Admins competing | No. Admin emails cannot register as members. |
| Proof | Screenshot upload only. No links. Optional short note. |
| Reference field | Required on every submission; used to block double-counting |
| Repeatability | All categories repeatable |
| Resubmission cap | 1 resubmission after a rejection. Second rejection is final unless an admin grants an override. |
| Withdrawals | Allowed while pending. Do not count against the cap. |
| Point values | Locked when the contest opens. Owner can unlock (logged). |
| Leaderboard | Inside member and admin dashboards only. No public page. |
| Zero-point members | Shown at the bottom, alphabetical, no rank number |
| Countdown timers | None anywhere |
| Ties | Higher points first; ties go to whoever reached that score first |

### Categories (seed data)

| Category | Points | Reference field label | Reference example |
|---|---|---|---|
| New Account | 2 | Account username | `jane_designs` |
| New Gig | 1 | Gig title | `i will build hubspot workflows` |
| New Message | 2 | Buyer username + date | `buyer123 2026-10-20` |
| Converted Message / Order | 5 | Fiverr order number | `FO1234567890` |

A buyer who messages and then orders earns the member 2 + 5 = 7. Messages from registered team members or their own accounts do not count (admin judgment, rejection reason "Staged / self-generated").

---

## 2. Architecture

```
Google Form ──► Google Sheet ──► Apps Script ──► Supabase Auth + Postgres ──► email key to member
 (register)      (intake)        (issuer)          (source of truth)

Member browser ──► Next.js (Vercel) ──► Supabase (RLS, RPC, Edge Functions, Storage)
Admin browser  ──►        "                       "

Website "Resend key" ──► Edge Function (rate limit + secret) ──► Apps Script web app ──► rotate + email
```

### Change from the review: member authentication

During the review, members were going to be checked against a SHA-256 key hash with a custom session system. The build uses **Supabase Auth with the key as the password** instead:

- Apps Script creates a Supabase Auth user per member (email + normalized key as password, email pre-confirmed).
- Members log in with `signInWithPassword`. Supabase stores the key with bcrypt.
- This gives proper sessions, row-level security via `auth.uid()`, Realtime on the member's own rows, and built-in rate limiting, without custom session code.
- The Google Sheet stores no key and no hash at all. The plain key exists only in the member's inbox.
- Key rotation = update the password + revoke the user's sessions.
- Deactivation = ban the auth user.

Everything else from the review stands.

### Tech stack

- Next.js (App Router), TypeScript, Tailwind CSS
- `@supabase/supabase-js` and `@supabase/ssr`
- `browser-image-compression` for client-side image compression
- Supabase CLI with SQL migrations in `supabase/migrations/`
- Supabase Edge Functions (Deno) in `supabase/functions/`
- Google Apps Script source kept in `apps-script/` (deployed manually by the owner, or with `clasp`)

### Repository layout

```
/
├── BUILD_PLAN.md
├── apps-script/
│   ├── Code.gs            # onFormSubmit, sync, menu, scheduled reconcile
│   ├── Resend.gs          # doPost web app endpoint for key rotation
│   ├── Supabase.gs        # REST + Auth admin API helpers
│   ├── Keys.gs            # key generation + normalization
│   └── appsscript.json
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── create-submission-draft/
│   │   ├── confirm-submission/
│   │   ├── request-new-key/
│   │   ├── admin-manage/
│   │   └── contest-export/
│   └── seed.sql
└── web/                    # Next.js app
```

---

## 3. Key format and normalization

- 12 characters from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O, 1, I, L).
- Generated with a cryptographically secure source (`Utilities.getUuid()` bytes or `Math.random` is NOT acceptable alone; derive from UUID/random bytes).
- Displayed in the email as `XXXX-XXXX-XXXX`.
- **Normalization (identical in Apps Script and the website):** remove all spaces and dashes, uppercase. The normalized 12-character string is the Supabase Auth password.
- A unit test on each side must assert that `"k7rm-qx4p 9wab"` normalizes to `"K7RMQX4P9WAB"`.

---

## 4. Data model (Supabase / Postgres)

All tables carry `contest_id` so a second contest is a new row, not a rebuild.

### Enums

- `contest_status`: `setup`, `open`, `closed`, `final`, `archived` (stored status only ever holds `setup`, `final`, `archived`; `open` and `closed` are derived from time, see below)
- `submission_status`: `draft`, `pending`, `approved`, `rejected`, `withdrawn`, `reversed`
- `admin_role`: `owner`, `admin`
- `actor_type`: `member`, `admin`, `system`

### `contests`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| start_at | timestamptz | |
| end_at | timestamptz | |
| grace_minutes | int default 10 | |
| manual_status | contest_status default `setup` | Only `setup`, `final`, `archived` set manually |
| points_unlocked | bool default false | Owner override of the points lock |
| finalized_at | timestamptz null | |
| results_updated_at | timestamptz null | Set when reopened and republished |
| created_at | timestamptz | |

**Effective status** — SQL function `contest_effective_status(contest_id)`:
- `archived` or `final` if `manual_status` is one of those
- else `setup` if `now() < start_at`
- else `open` if `now() < end_at`
- else `closed`

No cron job is needed for open/closed.

### `members`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | = `auth.users.id` |
| contest_id | uuid fk | |
| email | citext | unique per contest |
| display_name | text | unique per contest, case-insensitive |
| key_version | int default 1 | increments on each rotation |
| active | bool default true | |
| registered_at | timestamptz | |
| updated_at | timestamptz | |

Full name stays in the Google Sheet only.

### `admins`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | = `auth.users.id` |
| email | citext unique | |
| role | admin_role | |
| active | bool default true | |
| created_at | timestamptz | |

Helper SQL functions: `is_admin()`, `is_owner()`, `is_member()` (active member of the current contest) based on `auth.uid()`.

### `categories`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| contest_id | uuid fk | |
| name | text | |
| points | int check > 0 | |
| reference_label | text | shown in the submit form |
| reference_hint | text | example shown under the field |
| active | bool default true | deactivate instead of delete |
| sort_order | int | |

### `submissions`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| contest_id | uuid fk | |
| member_id | uuid fk | |
| category_id | uuid fk | |
| reference | text | as typed |
| reference_normalized | text | see normalization below |
| note | text null | max 280 chars |
| proof_path | text | storage path |
| proof_hash | text null | SHA-256 of the uploaded file |
| status | submission_status | |
| attempt | int default 1 | 1 = original, 2 = resubmission, 3+ only via override |
| resubmission_of | uuid null fk → submissions | |
| override_granted | bool default false | set on the rejected submission to allow one more attempt |
| flags | text[] default '{}' | e.g. `reused_proof` |
| points_awarded | int null | copied from category at approval |
| reject_reason_code | text null | |
| reject_reason_text | text null | |
| claimed_by | uuid null | admin hold |
| claimed_until | timestamptz null | 5-minute hold |
| reviewed_by | uuid null | |
| reviewed_at | timestamptz null | |
| created_at | timestamptz | draft creation time |
| submitted_at | timestamptz null | confirm time (used for tie-break) |

**Reference normalization:** lowercase, trim, collapse internal whitespace to single spaces, strip a leading `@` or `#`.

**Constraints and indexes**
- Partial unique index on `(contest_id, category_id, reference_normalized)` where `status in ('pending','approved')`. This blocks the same account, gig, message, or order being pending or approved twice, across all members.
- Partial unique index on `resubmission_of` where `status <> 'withdrawn'`. One live resubmission per rejected submission.
- Index on `(contest_id, status, submitted_at)` for the admin queue.
- Index on `proof_hash`.

**Resubmission rules (enforced in the RPC, not the UI)**
- Resubmitting requires the parent to belong to the same member, be `rejected` or `reversed`, and be in the same category.
- If the parent has `attempt >= 2`, resubmission is only allowed when `override_granted = true` on the parent.
- New submission gets `attempt = parent.attempt + 1`.

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| id | bigserial pk | |
| contest_id | uuid | |
| actor_type | actor_type | |
| actor_id | uuid null | `auth.uid()`; null for system |
| action | text | e.g. `submission.approved` |
| entity | text | table name |
| entity_id | uuid | |
| before | jsonb | |
| after | jsonb | |
| reason | text null | |
| created_at | timestamptz | |

- Filled by `AFTER INSERT/UPDATE/DELETE` triggers on `contests`, `members`, `admins`, `categories`, `submissions`.
- Actor resolution in the trigger: if `auth.uid()` is an admin → `admin`; a member → `member`; otherwise (service role from Apps Script / Edge Functions) → `system`. Edge Functions that act on behalf of a user must call RPCs with the user's JWT so `auth.uid()` is set.
- Reasons are passed via `set_config('app.reason', ..., true)` inside RPCs and read by the trigger.
- No UPDATE or DELETE privilege on `audit_log` for `anon`, `authenticated`, or `service_role` via the API. Insert only through triggers.

### `key_requests`

`(id, email citext, requested_at)` — rate limiting for the resend-key flow.

### Guard triggers

- **Points lock:** block `categories.points` updates when effective status is not `setup`, unless `contests.points_unlocked = true`.
- **Deadline:** when effective status is `open`, `end_at` may only increase. Shortening is rejected.
- **Freeze:** when effective status is `final` or `archived`, block any change to `submissions` and `categories`.
- **Category deletion:** block DELETE on categories that have any submissions; use `active = false`.

---

## 5. Row-level security

Enable RLS on every table. `anon` gets **no** access to any table, view, or RPC except what Supabase Auth itself needs.

| Table | Member (authenticated, is_member) | Admin | Owner |
|---|---|---|---|
| contests | select current contest | select | select, update via RPC |
| members | select own row only | select all | select all |
| admins | none | select | select, manage via Edge Function |
| categories | select active | select all, insert/update via RPC | same |
| submissions | select own rows | select all | select all |
| audit_log | none | select | select |
| key_requests | none | none | none |

All writes go through RPC functions (`security definer`, explicit `search_path`, explicit permission checks inside) or Edge Functions. No direct INSERT/UPDATE grants on tables to `authenticated`.

### Storage

- Private bucket `proofs`, file size limit 2 MB, allowed MIME types `image/jpeg`, `image/png`, `image/webp`.
- Path: `{contest_id}/{member_id}/{submission_id}.{ext}`.
- Uploads only through signed upload URLs issued by `create-submission-draft`.
- Members may read only objects under their own `member_id` folder; admins may read all. Reads use short-lived signed URLs (5 minutes).

---

## 6. RPC functions

All take effect only after permission and state checks. All write audit entries through triggers.

### Shared
- `get_leaderboard()` — requires `is_member()` or `is_admin()`. Returns for each **active** member: `display_name`, `points`, `tasks_completed`, `rank`, `reached_at`, `is_me`.
  - `points` = sum of `points_awarded` where status `approved`.
  - `reached_at` = max `submitted_at` among approved submissions.
  - Members with points > 0: order by `points desc, reached_at asc`, rank 1..n.
  - Members with 0 points: after all ranked members, order by `display_name`, `rank = null`.
- `get_admin_leaderboard()` — admin only. Same as above plus `member_id`, `email`, `pending_count`, `active`, and includes inactive members (flagged).
- `get_contest_banner()` — returns effective status, start/end, pending count (for "Provisional: X submissions under review"), `finalized_at`, `results_updated_at`.

### Member
- `withdraw_submission(id)` — own submission, status `pending`, effective status `open` or `closed` within grace → `withdrawn`.
- `my_resubmission_allowance(id)` — returns whether a rejected/reversed submission can be resubmitted.

(Draft creation and confirmation are Edge Functions because they need Storage access and file hashing.)

### Admin
- `claim_submission(id)` — sets `claimed_by`/`claimed_until = now() + 5 min` if unclaimed or expired or already held by caller.
- `approve_submission(id)` — status must be `pending`; copies current `categories.points` to `points_awarded`; sets reviewer fields. Uses `UPDATE ... WHERE status = 'pending'` and returns an "already reviewed" error if zero rows changed.
- `reject_submission(id, reason_code, reason_text)` — reason required; same pending guard.
- `reverse_submission(id, reason)` — approved → `reversed`; `points_awarded` kept for the record but excluded from totals.
- `correct_rejection(id, reason)` — rejected → approved (logged as correction).
- `grant_override(id, reason)` — on a rejected/reversed attempt ≥ 2; sets `override_granted = true`.
- `set_member_active(member_id, active)` — admin; also triggers the auth ban/unban through the `admin-manage` Edge Function.
- `upsert_category(...)`, `set_category_active(id, bool)`.

### Owner
- `set_points_unlocked(bool, reason)`
- `extend_deadline(new_end_at, reason)`
- `publish_final(reason)` — requires effective status `closed` and zero pending submissions; sets `manual_status = final`, `finalized_at`.
- `reopen_contest(reason)` — final → back to time-derived status (`manual_status = setup`; since `end_at` is past, effective status becomes `closed`); republishing sets `results_updated_at`.
- `archive_contest(reason)` — requires final and `now() > finalized_at + 30 days`; Edge Function deletes storage objects after export.

### Rejection reason presets
`unclear_screenshot`, `wrong_category`, `incomplete`, `duplicate`, `staged_self_generated`, `other` (free text required for `other`).

---

## 7. Edge Functions

All secrets live in Supabase Edge Function secrets. None of these secrets go to Vercel.

### `create-submission-draft`
Input: `category_id`, `reference`, `note`, `file_ext`, optional `resubmission_of`. Uses the caller's JWT.
1. Verify caller is an active member.
2. Effective status must be `open`.
3. Category active; reference non-empty; note ≤ 280 chars.
4. Rate limit: max 20 drafts per member per hour.
5. If `resubmission_of` is set, apply the resubmission rules.
6. Check the reference uniqueness early (friendly error before upload).
7. Insert `draft` submission; create a signed upload URL for the storage path.
8. Return submission id + upload URL.

### `confirm-submission`
Input: `submission_id`.
1. Own draft only.
2. Allowed if effective status is `open`, or if `closed` and `draft.created_at < end_at` and `now() <= end_at + grace_minutes`.
3. Verify the file exists in storage; compute its SHA-256.
4. If the same `proof_hash` exists on any non-withdrawn submission in the contest, add flag `reused_proof`.
5. Set status `pending`, `submitted_at = now()`.
6. Unique-index violation → return "This reference has already been submitted" and delete the draft + file.

### Draft cleanup
Scheduled job (pg_cron or a scheduled Edge Function) every 15 minutes: delete drafts older than 60 minutes and their files.

### `request-new-key`
Public (no login). Input: `email`.
1. Rate limit: 3 requests per email per hour, 20 per IP per hour (store in `key_requests`).
2. Always return the same message: "If this email is registered, a new key has been sent."
3. If the email belongs to an active member, POST to the Apps Script web app URL with a shared secret header and the email.

### `admin-manage` (owner only, except ban/unban which any admin may trigger)
- `invite_admin(email, role)` — creates/invites a Supabase Auth user and inserts into `admins`.
- `remove_admin(id)` — sets inactive, bans the auth user, revokes sessions.
- `ban_member(id)` / `unban_member(id)` — Supabase Auth admin `ban_duration`.

### `contest-export` (owner)
Produces two CSVs: final standings (from `get_admin_leaderboard`) and the full audit log. Returned as downloads in the admin UI. Must run before `archive_contest`.

### Session revocation helper
SQL function `revoke_user_sessions(user_id)` (`security definer`, callable by `service_role` only) that deletes from `auth.sessions` for that user. Set the Supabase JWT expiry to 1 hour so revoked users lose access within the hour at most. Verify this approach against current Supabase docs during the build.

### Login lockout
Use the Supabase Auth **password verification hook** to lock an email for 15 minutes after 5 failed attempts in 15 minutes. If the hook is unavailable on the current plan, fall back to Supabase Auth's built-in rate limits and note it for the owner. Login errors always show "Email or key is incorrect."

---

## 8. Google Form, Sheet, and Apps Script

### Form
- Settings: collect email addresses (responder input, validated), **response editing off**, no Google sign-in required.
- Questions: Full name, Display name (shown to teammates on the leaderboard), Team access code (short answer, response validation: text → exactly matches the code), Consent checkbox.
- Consent text: "I agree that my name and email are used to run this contest, and that my display name will be visible to other team members on the leaderboard."
- Confirmation message: "You're registered. Your login key is on its way by email. Check spam or Promotions if it hasn't arrived in a few minutes."

### Sheet columns
Form-owned columns stay untouched (never sort, insert, or delete in them). Script-owned columns to the right:

`Member ID | Key version | Key issued at | Sync status | Last synced | Email status | Active | Synced fingerprint | Notes`

`Active` is a checkbox the owner can untick to deactivate. No key and no hash is ever written to the Sheet.

### Script Properties
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CONTEST_ID`, `RESEND_SHARED_SECRET`, `SITE_URL`, `SUPPORT_CONTACT`.

### `onFormSubmit` flow
Wrap the whole flow in `LockService.getScriptLock()`.
1. Read the row. Normalize email (trim, lowercase) and display name (trim, collapse spaces, title-case only if entirely lower- or upper-case).
2. Check contest effective status via RPC. If `closed`, `final`, or `archived`: mark the row "Registration closed", do not issue a key.
3. If the email is in `admins` → mark row "Admin email — rejected", stop.
4. If the display name is taken by another member, append ` 2`, ` 3`, etc. and note it in the email.
5. If the email already exists as a member → rotation path (keep Member ID, generate new key, update password, increment `key_version`, revoke sessions).
   Else → create path (generate key, create Supabase Auth user with `email_confirm: true` and the normalized key as password, insert `members` row with the auth user id).
6. On Supabase success: write Member ID, Key version, Key issued at, Sync status "OK", Last synced, Active ✓, fingerprint.
7. Send the email (MailApp). Write Email status "Sent" or "Failed: <error>".
8. On Supabase failure: Sync status "Failed: <error>", no email. The scheduled reconcile retries the whole flow with a **new** key (the failed key was never delivered).

### Email
- Subject: `Your contest login key`
- Plain text body: greeting with display name, the key as `XXXX-XXXX-XXXX`, the login link, "Keep this key private. Anyone with it can submit as you.", how to get a new key (the "Resend my key" link on the login page), support contact.

### Custom menu "Contest"
- Sync selected row now
- Sync all now
- Resend key for selected row (rotation path)
- Close registration now

### Scheduled reconcile (time trigger every 10 minutes)
- Retry rows with Sync status starting "Failed".
- For rows whose `Synced fingerprint` (hash of display name + Active) differs from current values: push display name changes; for Active changes call ban/unban + `members.active`.
- Members present in Supabase whose Sheet row was deleted: write a note in a `Orphans` tab; never delete them in Supabase.
- If the contest effective status is `closed` or later: `FormApp.openByUrl(...).setAcceptingResponses(false)`.

### `doPost` web app (Resend.gs)
- Deployed as web app, execute as owner, access "Anyone".
- Reject any request without the correct `X-Resend-Secret` header value (compare in constant time).
- Look up the member by email; run the rotation path; email the new key; return 200 with no member details.

### Quotas to respect
MailApp ~100 recipients/day on a personal Gmail account. Show the remaining daily quota (`MailApp.getRemainingDailyQuota()`) in the menu so the owner can see it.

---

## 9. Website (Next.js on Vercel)

Mobile-first. Neutral, clean styling. No countdowns anywhere.

### Environment variables on Vercel
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Nothing else secret.

### Routes

**Public (logged out)**
- `/login` — email + key. Key input auto-formats as `XXXX-XXXX-XXXX` while typing; normalized before `signInWithPassword`. Link to `/resend`.
- `/resend` — email field → `request-new-key`; shows the generic message.
- Everything else redirects to `/login`.

**Member (`/dashboard`)**
- Banner from `get_contest_banner`:
  - setup: "Submissions open on {date}" (submit disabled)
  - open: none
  - closed: "Provisional: {n} submissions under review"
  - final: "Final results" (and "Results updated {date}" if reopened)
- Standing card: my points, my rank (or "Not ranked yet").
- Leaderboard: rank, display name, points, tasks completed. My row highlighted; when off-screen, a sticky copy of my row is pinned at the top. Refreshes every 30 seconds.
- Submit panel: category select (shows points), reference field (label and hint from the category), screenshot picker, optional note, submit. Image compressed in the browser to max 1600 px on the long edge, WebP, target ≤ 500 KB; reject files over 5 MB before compression. Flow: draft → upload → confirm, with clear progress and a retry if the upload fails.
- My submissions: category, reference, submitted time, status, points awarded, rejection reason, thumbnail (signed URL). Actions: Withdraw (pending), Resubmit (rejected/reversed when allowed; pre-fills category and reference). Realtime subscription on own submissions.
- Empty state for new members explaining how to submit.
- Log out.

**Admin**
- `/admin/login` — email + password.
- `/admin` — queue: pending submissions, oldest first, with waiting time and flags (reused proof, resubmission). Shows who currently holds each item.
- `/admin/review/[id]` — claims on open. Full-size screenshot with zoom, category, points, reference, note, member display name, flags. For resubmissions: previous screenshot + previous reason side by side, and a warning "Rejecting this is final." Approve / Reject (preset reason + text). Handles "already reviewed".
- `/admin/members` — admin leaderboard with pending counts, inactive members greyed, click-through to `/admin/members/[id]` (full history, grant override, reverse approvals, correct rejections, deactivate/reactivate).
- `/admin/categories` — list, add, edit name/label/hint, deactivate. Points field disabled when locked.
- `/admin/contest` (owner) — dates, extend deadline, points unlock, publish final, reopen, export CSVs, archive.
- `/admin/admins` (owner) — invite, remove, list.
- `/admin/log` — audit log, filterable by member, action, date.
- `/admin/board` — full-screen leaderboard for projecting.

Admin sessions: sign out after 12 hours of inactivity (client-side timer + server check of `last_sign_in_at`).

---

## 10. Contest lifecycle

| Effective status | Registration | Login | Submissions | Review | Board |
|---|---|---|---|---|---|
| setup | open | yes | disabled | n/a | zero for all |
| open | open | yes | yes | yes | live |
| closed | closed (Form auto-closed) | yes | confirm drafts within grace only | yes | "Provisional" |
| final | closed | yes | no | no (read-only) | "Final", frozen |
| archived | closed | yes | no | no | "Final"; screenshots deleted |

- Tasks/categories added mid-contest: allowed, logged.
- Deadline: extend only.
- Reopen after final: owner, with reason; republish sets "Results updated".
- Export before archive. Archive only after 30 days past `finalized_at`.

---

## 11. Build phases and acceptance checks

### Phase 0 — Project setup
- Init repo with the layout in section 2, Next.js + Tailwind in `web/`, Supabase CLI project in `supabase/`.
- Local Supabase running.
- **Done when:** `web` dev server runs, `supabase start` works, migrations folder exists.

### Phase 1 — Database
- Enums, tables, indexes, guard triggers, audit triggers, helper functions, RPCs, RLS, storage bucket + policies, seed (one contest, four categories, one owner admin placeholder).
- SQL tests (pgTAP or plain SQL scripts) for every acceptance check below.
- **Done when:**
  - Same `(category, reference)` cannot be pending/approved twice across members.
  - A rejected submission accepts exactly one resubmission; a second rejection blocks further resubmission unless overridden.
  - Withdrawn resubmission frees the slot.
  - Points cannot change after start unless unlocked.
  - `end_at` cannot decrease while open.
  - Nothing changes in final state.
  - Every state change produces an `audit_log` row with correct actor.
  - `get_leaderboard` ordering: points desc, earliest `reached_at`, zero-point members alphabetical with null rank; inactive members excluded.
  - Two concurrent `approve_submission` calls on the same id award points once.

### Phase 2 — Apps Script
- All files in `apps-script/`, with setup instructions in `apps-script/README.md` (Script Properties, triggers, web app deployment, Form settings).
- **Done when:** a test Form submission creates an auth user + member row, writes the Sheet columns, and sends an email; a second submission with the same email rotates the key and the old key stops working; an admin email is rejected; Supabase down → row marked failed, reconcile recovers it; unticking Active bans the member.

### Phase 3 — Edge Functions
- `create-submission-draft`, `confirm-submission`, draft cleanup, `request-new-key`, `admin-manage`, `contest-export`, session revocation helper, login lockout hook.
- **Done when:** full draft → upload → confirm flow works; grace window rule enforced; reused screenshot flagged; resend flow rotates key via Apps Script and returns the generic message for unknown emails; rate limits enforced.

### Phase 4 — Member UI
- **Done when:** login (with messy key formatting) works; banner states render; submission works on a throttled mobile connection; withdraw and resubmit follow the rules; status updates appear live; leaderboard highlights and pins own row.

### Phase 5 — Admin UI
- **Done when:** queue, claim hold, approve/reject with "already reviewed" handling, reversal, correction, override, members, categories (points locked), owner pages, log viewer, full-screen board all work; non-owner admins cannot reach owner actions (server-enforced, not just hidden).

### Phase 6 — Lifecycle and exports
- **Done when:** a contest can be run end to end on short test dates: setup → open → closed (Form auto-closes) → final → reopen → final → export → archive (with the 30-day check bypassed only in a test environment).

### Phase 7 — Security pass
Run with real keys against a staging Supabase project:
- Logged-out (anon key): every table, view, RPC, and storage path returns nothing or an error, except login and `request-new-key`.
- Member: cannot read other members' submissions, emails, proof files, the audit log, or admins; cannot call admin RPCs.
- Admin: cannot invite/remove admins or run owner RPCs.
- Removed admin and deactivated member lose access within the JWT expiry window.
- Old key fails after rotation.
- No secret other than the anon key appears in the Vercel bundle (search the build output).

### Phase 8 — Launch checklist (owner does these)
- Supabase: disable public sign-ups, set JWT expiry to 1 hour, set Site URL to the Vercel domain, create the owner admin.
- Vercel: env vars set, production domain configured.
- Form: email collection on, response editing off, access code validation set, consent text, confirmation message.
- Apps Script: Script Properties set, triggers installed (on form submit, every 10 minutes), web app deployed and URL stored in Edge Function secrets.
- Test registration end to end with one real teammate before sharing the link.
- Set contest start/end dates; confirm categories and points before start (they lock at start).

---

## 12. Secrets inventory

| Secret | Lives in | Never in |
|---|---|---|
| Supabase service role key | Apps Script Script Properties, Supabase Edge Function secrets | Vercel, Sheet cells, Git |
| Resend shared secret | Apps Script Script Properties, Edge Function secrets | Vercel, Git |
| Apps Script web app URL | Edge Function secrets | Vercel |
| Team access code | Google Form validation only | Git |
| Supabase anon key | Vercel env vars | — |

Add `.env*` and any credentials files to `.gitignore` from the first commit.

---

## 13. Out of scope for v1

Public leaderboard page, email notifications for approvals/rejections, two-factor auth, batch approvals, multiple simultaneous contests in the UI, payments, branding/theming system. The schema already supports multiple contests for later.
