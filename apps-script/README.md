# Apps Script: registration, key issuing, key resend

Bound to the Google Sheet that receives the registration Form. It is the **only** component that
creates or rotates member keys. The key exists only in the member's inbox: the Sheet and Supabase
never store it (Supabase keeps a bcrypt hash as the member's Auth password).

| File | Role |
|---|---|
| `Code.gs` | `onFormSubmit`, `reconcile` (every 10 min), `installTriggers`, "Contest" menu, email |
| `Supabase.gs` | REST + Auth admin API helpers (service key from Script Properties) |
| `Keys.gs` | key generation + normalization |
| `Resend.gs` | `doPost` web app used by the website's "Resend my key" |
| `appsscript.json` | manifest (scopes, web app settings) |

## 1. The Google Form

Settings:
- **Collect email addresses: "Responder input"** (validated). No Google sign-in required.
- **Allow response editing: OFF.**
- Limit to 1 response: OFF (a returning participant can register again without changing their existing key).

Questions (the titles matter: the script finds columns by these words):
1. `Full name` (short answer, required)
2. `Display name` (short answer, required), description: "Shown to teammates on the leaderboard"
3. `Title` (short answer, required), description: "Your professional title, for example HubSpot Specialist. Shown next to your name". The script finds this column by the word "title" in the question, so "Professional title" works too. Up to 80 characters. Titles are for organizers: they are visible to admins (and to the member themselves in their greeting), never on the leaderboard or to teammates. Leave the question optional if you do not want to force it.
4. `Team access code` (short answer, required). **Response validation → Regular expression → Matches**
   with the pattern `^YOUR-CODE$`, so only the exact code passes (escape any regex characters in the code).
   The code lives only in the Form; never put it in Git or in this script.
5. Consent checkbox, required, text:
   > I agree that my name, email and title are used to manage organisation contests, and that my display name will be visible to other participants on the leaderboard.

Confirmation message:
> You're on the organisation roster. First-time participants receive a login key by email; returning participants should use their existing key. You'll join the next contest automatically.

Then **Responses → Link to Sheets** (create a new spreadsheet). Keep the tab name `Form Responses 1`
(or set the `RESPONSES_SHEET` property). Never sort, insert or delete columns in the Form-owned columns.
Share the spreadsheet with as few people as possible: it holds names and emails.

## 2. Install the script

In the spreadsheet: **Extensions → Apps Script**. Create the four `.gs` files and paste the contents
(show `appsscript.json` under Project Settings → "Show appsscript.json" and paste that too).
Or use `clasp push` (keep `.clasp.json`, which is git-ignored, out of Git).

## 3. Script Properties

Project Settings → **Script Properties**:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** key (Settings → API). Never share, never commit |
| `ORGANIZATION_ID` | the organisation's `id` (`select id from organizations where slug = 'your-slug';`) |
| `RESEND_SHARED_SECRET` | a long random string; the same value goes into the Edge Function secret |
| `SITE_URL` | the Vercel URL, e.g. `https://contest.example.com` (no trailing slash needed) |
| `SUPPORT_CONTACT` | e.g. an email address or "ask Sam in the team chat" |
| `RESPONSES_SHEET` | optional, default `Form Responses 1` |

## 4. Triggers

Run `installTriggers` once from the editor (authorize when asked). It creates:
- **On form submit** → `onFormSubmit`
- **Time-driven, every 10 minutes** → `reconcile`

Safe to run again; it replaces its own triggers.
Run it in the Apps Script project opened from the **response spreadsheet** (Extensions → Apps
Script), not from the Google Form. The spreadsheet's form-submit event provides the response row
range that `onFormSubmit` needs. If Apps Script reports "no spreadsheet range", the trigger is
attached to a Form instead; install the triggers again from the response spreadsheet. The
10-minute reconciliation will recover missed responses.

## 5. Web app (for "Resend my key")

**Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Copy the
`/exec` URL and store it as the Supabase Edge Function secret `APPS_SCRIPT_URL`. After changing the
script, **Deploy → Manage deployments → edit → New version** (the URL stays the same).

> **Deviation from BUILD_PLAN.md:** the plan says the secret is an `X-Resend-Secret` *header*. Apps
> Script web apps cannot read request headers, so the secret is sent in the HTTPS JSON body
> (`{"secret": "...", "email": "..."}`) and compared in constant time. The URL itself is also only
> known to the Edge Function.

## 6. What it does

**New onboarding** (Form submit): validates the email → rejects admin emails → creates the Supabase
Auth user (email pre-confirmed, normalized key as password) and adds the person to the persistent
`organization_members` roster. If the organisation has a contest in `setup`/`open`, the same
transaction adds a `members` row to that contest. Otherwise the person remains on the roster and is
automatically enrolled when the owner starts the next contest. The Form can therefore stay open
between contests. It is one Form, response Sheet and Apps Script project per organisation, not per
contest. If an older script already closed the Form when a contest ended, re-open **Accepting
responses** once in the Form; this script no longer closes it automatically.

If an active participant on the organisation roster registers again, the account and existing key
are kept; a notice email tells them to use their current key. The separate **Resend my key** flow
still issues a replacement key and invalidates the old one. A taken display name becomes `Name 2`,
`Name 3`… and the member is told in the email.

**Reconcile (every 10 min):**
- retries rows whose `Sync status` starts with `Failed` (with a **new** key: the failed one was never delivered)
- rows whose email failed get a fresh key and a new email
- pushes Sheet edits: display name changes, **Title** changes (clear the cell to remove a title), and the **Active** checkbox (untick = member is deactivated and
  banned in Supabase; tick again = restored). DB-side changes are never overwritten, only Sheet edits are pushed.
- lists organisation roster members without a Sheet row on an `Orphans` tab (never deletes them)

**Contest menu:** sync selected row, sync all, resend key for selected row, close registration now,
and the remaining daily email quota (personal Gmail: about 100 emails a day; a Workspace account gets more).

Sync statuses you may see: `OK`, `Admin email — rejected`,
`Deactivated — no key sent`, `Rejected: …`, `Failed: …` (will be retried), `Sync error: …` (edit push will be retried).

## 7. Tests

```bash
cd apps-script && npm test
```
Runs the real `.gs` files in Node with in-memory fakes of Sheets/Mail/Form and of Supabase
(PostgREST + GoTrue admin API). It covers: create, preserve an existing key on re-registration,
admin email rejected, always-on organisation onboarding, roster-only registrations while contests
are closed, Supabase down → failed → reconcile recovers, Active checkbox bans/unbans, name
collisions, the resend endpoint (secret, unknown emails, quota), and key
generation/normalization (`"k7rm-qx4p 9wab"` → `"K7RMQX4P9WAB"`).
The fakes do not prove behaviour against the real Google and Supabase services, so do the launch
checklist's end-to-end registration test with a real teammate.
