// Security probe over HTTP (PostgREST / Supabase REST API). Phase 7 of BUILD_PLAN.md, as a script.
//
//  Local (PostgREST on the test database):  see ./run.sh
//  Staging / production-like project:
//    PROBE_URL=https://<ref>.supabase.co  PROBE_ANON_KEY=<anon key>
//    PROBE_MEMBER_EMAIL=.. PROBE_MEMBER_KEY=..          (a real member and the key from their email)
//    PROBE_ADMIN_EMAIL=.. PROBE_ADMIN_PASSWORD=..       (a non-owner admin)
//    PROBE_OWNER_EMAIL=.. PROBE_OWNER_PASSWORD=..       (optional)
//    node supabase/tests/http/probe.mjs
//  It only reads and tries forbidden things; it never changes data when the project is configured
//  correctly (a forbidden write that unexpectedly works is reported as a failure).
import crypto from 'node:crypto';

const env = process.env;
const BASE = (env.PROBE_URL ?? '').replace(/\/+$/, '');
const PREFIX = env.PROBE_REST_PREFIX ?? '/rest/v1';
const ANON = env.PROBE_ANON_KEY ?? '';
if (!BASE) { console.error('PROBE_URL is required'); process.exit(2); }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${crypto.createHmac('sha256', env.PROBE_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function login(kind) {
  const E = kind.toUpperCase();
  if (env.PROBE_JWT_SECRET) {   // local mode: mint tokens for fixture users
    const id = env[`PROBE_${E}_ID`];
    return id ? { token: sign({ role: 'authenticated', sub: id }), id } : null;
  }
  const email = env[`PROBE_${E}_EMAIL`], password = env[`PROBE_${E}_KEY`] ?? env[`PROBE_${E}_PASSWORD`];
  if (!email || !password) return null;
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`could not log in as ${kind}: HTTP ${r.status}`);
  const j = await r.json();
  return { token: j.access_token, id: j.user.id };
}

async function call(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (ANON || token) headers.apikey = ANON || token;
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (ANON) headers.Authorization = `Bearer ${ANON}`;
  const r = await fetch(`${BASE}${PREFIX}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, text };
}
const get = (p, t) => call('GET', p, t);
const rpc = (n, t, args = {}) => call('POST', `rpc/${n}`, t, args);

let pass = 0, fail = 0, skipped = 0;
const check = (cond, name, detail = '') => { if (cond) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
const skip = (name, why) => { skipped++; console.log(`  skip  ${name} (${why})`); };
const noRows = (r) => [401, 403].includes(r.status) || (r.ok && Array.isArray(r.json) && r.json.length === 0);
// "denied" means the privilege/policy layer refused (401/403). A 400/409 would mean the statement or
// function actually ran and failed later (validation, constraint), which is NOT a pass.
const denied = (r) => r.status === 401 || r.status === 403;
const forbiddenRpc = (r) => r.status === 403 && /forbidden|not_member|permission denied/i.test(r.text);
const NOBODY = '00000000-0000-0000-0000-000000000000';   // matches zero rows: a granted write succeeds harmlessly

const TABLES = ['contests', 'members', 'admins', 'categories', 'submissions', 'audit_log', 'key_requests', 'login_failures'];
const ADMIN_RPCS = [['get_admin_leaderboard', {}], ['claim_submission', { p_id: crypto.randomUUID() }], ['approve_submission', { p_id: crypto.randomUUID() }],
  ['reject_submission', { p_id: crypto.randomUUID(), p_reason_code: 'other', p_reason_text: 'x' }], ['reverse_submission', { p_id: crypto.randomUUID(), p_reason: 'x' }],
  ['correct_rejection', { p_id: crypto.randomUUID(), p_reason: 'x' }], ['grant_override', { p_id: crypto.randomUUID(), p_reason: 'x' }],
  ['set_member_active', { p_member: crypto.randomUUID(), p_active: false }], ['upsert_category', { p_id: null, p_name: 'x', p_points: 1, p_reference_label: 'x', p_reference_hint: '', p_sort_order: 1 }],
  ['set_category_active', { p_id: crypto.randomUUID(), p_active: false }]];
const OWNER_RPCS = [['update_contest_setup', { p_name: 'x', p_start: '2030-01-01', p_end: '2030-02-01', p_grace: 1 }], ['set_points_unlocked', { p_unlocked: true, p_reason: 'x' }],
  ['extend_deadline', { p_new_end: '2031-01-01', p_reason: 'x' }], ['publish_final', { p_reason: 'x' }], ['reopen_contest', { p_reason: 'x' }], ['owner_mark_exported', {}],
  ['archive_contest', { p_reason: 'x' }], ['owner_add_admin', { p_user: crypto.randomUUID(), p_email: 'probe@example.com', p_role: 'admin' }],
  ['owner_set_admin_active', { p_id: crypto.randomUUID(), p_active: false }]];
const SERVICE_RPCS = [['revoke_user_sessions', { p_user: crypto.randomUUID() }], ['auth_user_id_by_email', { p_email: 'a@example.com' }],
  ['rate_limit_key_request', { p_email: 'a@example.com', p_ip: '1.1.1.1' }], ['confirm_submission_draft', { p_member: crypto.randomUUID(), p_id: crypto.randomUUID(), p_hash: 'x' }],
  ['_standings', { p_contest: crypto.randomUUID() }], ['hook_password_verification_attempt', { event: {} }], ['login_check', { p_email: 'a@example.com' }], ['login_record', { p_email: 'a@example.com', p_success: false }], ['_login_lock_seconds', { p_failures: 5 }], ['contest_effective_status', { p_contest: crypto.randomUUID() }]];

console.log('Anonymous (anon key only)');
for (const t of TABLES) check(noRows(await get(`${t}?select=*`, null)), `cannot read ${t}`);
for (const [n, a] of [...ADMIN_RPCS, ...OWNER_RPCS, ...SERVICE_RPCS, ['get_leaderboard', {}], ['get_contest_banner', {}], ['my_submissions', {}], ['is_admin', {}]]) {
  check(denied(await rpc(n, null, a)), `cannot call ${n}`);
}
check(denied(await call('POST', 'submissions', null, { reference: 'x' })), 'cannot insert submissions');
check(denied(await call('PATCH', `members?id=eq.${NOBODY}`, null, { display_name: 'x' })), 'cannot update members');
check(denied(await call('DELETE', `submissions?id=eq.${NOBODY}`, null)), 'cannot delete submissions');

const member = await login('member');
const admin = await login('admin');
const owner = await login('owner');

if (member) {
  console.log('Member');
  const subs = await get('submissions?select=id,member_id', member.token);
  check(subs.ok && subs.json.every((r) => r.member_id === member.id), 'sees only their own submissions', JSON.stringify(subs.json?.slice?.(0, 2)));
  const mem = await get('members?select=id,email', member.token);
  check(mem.ok && mem.json.length === 1 && mem.json[0].id === member.id, 'sees only their own member row (no other emails)');
  check(noRows(await get('admins?select=*', member.token)), 'cannot read admins');
  check(noRows(await get('audit_log?select=*', member.token)), 'cannot read the audit log');
  check(denied(await get('key_requests?select=*', member.token)), 'cannot read key_requests');
  check(denied(await get('login_failures?select=*', member.token)), 'cannot read login_failures');
  const cats = await get('categories?select=active', member.token);
  check(cats.ok && cats.json.every((c) => c.active), 'sees only active categories');
  for (const [n, a] of [...ADMIN_RPCS, ...OWNER_RPCS]) check(forbiddenRpc(await rpc(n, member.token, a)), `cannot call ${n}`);
  for (const [n, a] of SERVICE_RPCS) check(denied(await rpc(n, member.token, a)), `cannot call ${n}`);
  check(denied(await call('POST', 'submissions', member.token, { reference: 'x' })), 'cannot insert submissions directly');
  check(denied(await call('PATCH', `submissions?id=eq.${NOBODY}`, member.token, { status: 'approved' })), 'cannot update submissions (e.g. approve their own)');
  check(denied(await call('PATCH', `members?id=eq.${NOBODY}`, member.token, { display_name: 'x' })), 'cannot edit members');
  check(denied(await call('PATCH', `categories?id=eq.${NOBODY}`, member.token, { points: 99 })), 'cannot edit categories');
  check(denied(await call('DELETE', `submissions?id=eq.${NOBODY}`, member.token)), 'cannot delete submissions');
  const lb = await rpc('get_leaderboard', member.token);
  check(lb.ok && Array.isArray(lb.json), 'can read the leaderboard');
  if (lb.ok && lb.json.length) {
    check(JSON.stringify(Object.keys(lb.json[0]).sort()) === JSON.stringify(['display_name', 'is_me', 'points', 'rank', 'reached_at', 'tasks_completed']), 'leaderboard exposes only name and scores (no emails, ids or titles)', Object.keys(lb.json[0]).join(','));
  }
  check(forbiddenRpc(await rpc('get_admin_leaderboard', member.token)), 'cannot read the admin leaderboard');
} else skip('member checks', 'no member credentials');

if (admin) {
  console.log('Admin (not owner)');
  const all = await get('submissions?select=id,member_id', admin.token);
  check(all.ok, 'can read submissions');
  if (member && all.ok) {
    const owners = new Set(all.json.map((r) => r.member_id));
    owners.size >= 2 ? check(true, 'sees submissions of several members') : skip('sees several members', 'fixture data has fewer than 2 members with submissions');
  }
  check((await get('audit_log?select=id&limit=1', admin.token)).ok, 'can read the audit log');
  check(denied(await get('key_requests?select=*', admin.token)), 'cannot read key_requests');
  check((await rpc('is_owner', admin.token)).json === false, 'is not an owner');
  for (const [n, a] of OWNER_RPCS) check(forbiddenRpc(await rpc(n, admin.token, a)), `cannot call owner RPC ${n}`);
  for (const [n, a] of SERVICE_RPCS) check(denied(await rpc(n, admin.token, a)), `cannot call ${n}`);
  check(denied(await call('PATCH', `submissions?id=eq.${NOBODY}`, admin.token, { status: 'approved' })), 'cannot write submissions directly');
  check(denied(await call('PATCH', `admins?id=eq.${NOBODY}`, admin.token, { role: 'owner' })), 'cannot promote anyone directly');
  check(denied(await call('POST', 'admins', admin.token, { email: 'x@example.com', role: 'owner' })), 'cannot add admins directly');
  check(denied(await call('DELETE', `audit_log?id=eq.0`, admin.token)), 'cannot delete audit log rows');
  check(denied(await call('PATCH', `audit_log?id=eq.0`, admin.token, { action: 'x' })), 'cannot edit audit log rows');
} else skip('admin checks', 'no admin credentials');

if (owner) {
  console.log('Owner');
  check((await rpc('is_owner', owner.token)).json === true, 'is an owner');
  check(denied(await call('PATCH', `contests?id=eq.${NOBODY}`, owner.token, { points_unlocked: true })), 'even the owner cannot write tables directly');
  check(denied(await call('DELETE', `audit_log?id=eq.0`, owner.token)), 'even the owner cannot delete audit log rows');
  for (const [n, a] of SERVICE_RPCS) check(denied(await rpc(n, owner.token, a)), `cannot call ${n}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
