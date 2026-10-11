// A tiny in-memory stand-in for the Supabase HTTP APIs the web app calls (Auth, PostgREST, Storage,
// Edge Functions). It exists only so the UI can be exercised in a browser without a Supabase project.
// It does NOT enforce RLS or the business rules: those are tested in supabase/tests.
import http from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const SHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560"><rect width="800" height="560" fill="#f6f7f9"/><rect width="800" height="56" fill="#1dbf73"/><rect x="24" y="18" width="120" height="20" rx="4" fill="#fff" opacity=".9"/><rect x="560" y="18" width="216" height="20" rx="10" fill="#fff" opacity=".35"/><rect x="40" y="90" width="340" height="24" rx="4" fill="#222"/><rect x="40" y="130" width="240" height="14" rx="4" fill="#9aa1ab"/><rect x="40" y="180" width="720" height="1" fill="#dfe2e7"/><g fill="#fff" stroke="#dfe2e7"><rect x="40" y="210" width="220" height="150" rx="8"/><rect x="290" y="210" width="220" height="150" rx="8"/><rect x="540" y="210" width="220" height="150" rx="8"/></g><g fill="#c9ced6"><rect x="56" y="226" width="188" height="70" rx="6"/><rect x="306" y="226" width="188" height="70" rx="6"/><rect x="556" y="226" width="188" height="70" rx="6"/></g><g fill="#222"><rect x="56" y="312" width="150" height="10" rx="3"/><rect x="306" y="312" width="130" height="10" rx="3"/><rect x="556" y="312" width="160" height="10" rx="3"/></g><g fill="#9aa1ab"><rect x="56" y="332" width="90" height="8" rx="3"/><rect x="306" y="332" width="100" height="8" rx="3"/><rect x="556" y="332" width="80" height="8" rx="3"/></g><text x="40" y="430" font-family="Arial" font-size="15" fill="#6b7280">Sample screenshot (preview data)</text></svg>`;

export function createMock() {
  const now = Date.now();
  const iso = (offsetMin) => new Date(now + offsetMin * 60000).toISOString();
  const users = {
    member: { id: '00000000-0000-4000-8000-000000000001', email: 'member@x.test', password: 'ABCD2345EFGH', kind: 'member' },
    admin: { id: '00000000-0000-4000-8000-000000000002', email: 'admin@x.test', password: 'adminpass1', kind: 'admin', role: 'admin' },
    owner: { id: '00000000-0000-4000-8000-000000000003', email: 'owner@x.test', password: 'ownerpass1', kind: 'admin', role: 'owner' },
    lockme: { id: '00000000-0000-4000-8000-000000000004', email: 'lockme@x.test', password: 'ABCD2345ZZZZ', kind: 'member' },
  };
  const state = {
    status: 'open',
    calls: [],
    cats: [
      { id: 'c1', name: 'New Account', points: 2, reference_label: 'Account username', reference_hint: 'jane_designs', active: true, sort_order: 1 },
      { id: 'c2', name: 'New Gig', points: 1, reference_label: 'Gig title', reference_hint: 'i will build hubspot workflows', active: true, sort_order: 2 },
      { id: 'c3', name: 'Converted Message / Order', points: 5, reference_label: 'Fiverr order number', reference_hint: 'FO1234567890', active: true, sort_order: 4 },
    ],
    board: [
      { display_name: 'Cy', title: 'Zapier Builder', points: 7, tasks_completed: 2, rank: 1, reached_at: iso(-120), is_me: false },
      { display_name: 'Ben', title: 'GoHighLevel Consultant', points: 5, tasks_completed: 1, rank: 2, reached_at: iso(-100), is_me: false },
      { display_name: 'Maya (member)', title: 'HubSpot Specialist', points: 2, tasks_completed: 1, rank: 3, reached_at: iso(-60), is_me: true },
      { display_name: 'Alpha', title: null, points: 0, tasks_completed: 0, rank: null, reached_at: null, is_me: false },
    ],
    subs: [
      { id: 's-rej', category_id: 'c2', category_name: 'New Gig', category_points: 1, reference: 'my gig', note: null, status: 'rejected', attempt: 1, resubmission_of: null, points_awarded: null,
        reject_reason_code: 'unclear_screenshot', reject_reason_text: 'Cannot read the title', proof_path: 'p/rej.png', created_at: iso(-300), submitted_at: iso(-300), reviewed_at: iso(-200), can_resubmit: true, resubmit_block: null },
      { id: 's-ok', category_id: 'c1', category_name: 'New Account', category_points: 2, reference: 'maya_designs', note: null, status: 'approved', attempt: 1, resubmission_of: null, points_awarded: 2,
        reject_reason_code: null, reject_reason_text: null, proof_path: 'p/ok.png', created_at: iso(-400), submitted_at: iso(-400), reviewed_at: iso(-380), can_resubmit: false, resubmit_block: null },
    ],
    pending: [
      { id: 'q1', reference: 'buyer77 2026-10-02', note: 'first message', proof_path: 'p/q1.png', status: 'pending', attempt: 1, resubmission_of: null, override_granted: false, flags: ['reused_proof'],
        claimed_by: null, claimed_until: null, submitted_at: iso(-95), member: { display_name: 'Ben', email: 'ben@x.test', title: 'GoHighLevel Consultant' }, category: { name: 'New Message', points: 2, reference_label: 'Buyer username + date' } },
      { id: 'q2', reference: 'acct_two', note: null, proof_path: 'p/q2.png', status: 'pending', attempt: 2, resubmission_of: 's-rej', override_granted: false, flags: [],
        claimed_by: null, claimed_until: null, submitted_at: iso(-30), member: { display_name: 'Cy', email: 'cy@x.test', title: 'Zapier Builder' }, category: { name: 'New Account', points: 2, reference_label: 'Account username' } },
    ],
    uploaded: [],
    failUploads: 0,
    clockOffsetMs: 0,      // tests move time forward to "wait out" a login delay
    failures: {},          // email -> failure timestamps (the login delay: 1 free, then 180 s, +1 min each, max 30 min)
  };
  const clock = () => Date.now() + state.clockOffsetMs;
  const lockSeconds = (email) => {
    const f = (state.failures[email] ?? []).filter((t) => t > clock() - 24 * 3600e3);
    if (!f.length) return 0;
    const wait = f.length < 2 ? 0 : Math.min(180 + (f.length - 2) * 60, 1800);
    return Math.max(0, Math.ceil((Math.max(...f) + wait * 1000 - clock()) / 1000));
  };
  const byToken = (req) => {
    const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return Object.values(users).find((u) => u.id === p.sub) ?? null; } catch { return null; }
  };
  const banner = () => ({ contest_id: 'k1', name: 'Fall Contest', status: state.status, start_at: iso(-1440), end_at: iso(1440), grace_minutes: 10,
    pending_count: state.pending.length, finalized_at: null, results_updated_at: null });

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    res.end(body === undefined ? '' : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') return send(res, 204);
    const chunks = [];
    const rawBuf = await new Promise((r) => { req.on('data', (c) => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks))); });
    const raw = rawBuf.toString('utf8');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* binary upload */ }
    const user = byToken(req);
    state.calls.push(`${req.method} ${p}`);

    // ---- Auth
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = Object.values(users).find((x) => x.email === body.email && x.password === body.password);
      if (!u) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, { access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id,
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: iso(-9999), last_sign_in_at: new Date().toISOString() } });
    }
    if (p === '/auth/v1/user') {
      if (!user) return send(res, 401, { code: 401, msg: 'invalid JWT' });
      return send(res, 200, { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: iso(-9999), last_sign_in_at: new Date().toISOString() });
    }
    if (p === '/auth/v1/logout') return send(res, 204);

    // ---- Edge Functions
    if (p === '/functions/v1/login') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const wait = lockSeconds(email);
      const minutes = (sec) => `${Math.max(1, Math.ceil(sec / 60))} minute${Math.ceil(sec / 60) === 1 ? '' : 's'}`;
      if (wait > 0) return send(res, 429, { error: 'locked', retry_after_seconds: wait, message: `Too many failed attempts. Try again in ${minutes(wait)}.` });
      const pw = body.mode === 'member' ? String(body.password ?? '').replace(/[\s-]/g, '').toUpperCase() : body.password;
      const u = Object.values(users).find((x) => x.email === email && x.password === pw);
      if (!u) {
        (state.failures[email] ??= []).push(clock());
        const after = lockSeconds(email);
        if (after > 0) return send(res, 429, { error: 'locked', retry_after_seconds: after, message: `Email or key is incorrect. Too many failed attempts. Try again in ${minutes(after)}.` });
        return send(res, 401, { error: 'invalid_credentials', message: 'Email or key is incorrect.' });
      }
      delete state.failures[email];
      return send(res, 200, { session: { access_token: jwt(u), refresh_token: 'r-' + u.id } });
    }
    if (p.startsWith('/functions/v1/')) {
      const fn = p.split('/').pop();
      if (fn === 'request-new-key') return send(res, 200, { message: 'If this email is registered, a new key has been sent.' });
      if (!user) return send(res, 401, { error: 'unauthorized', message: 'Please log in again.' });
      if (fn === 'create-submission-draft') {
        if (body.reference === 'dup') return send(res, 409, { error: 'duplicate_reference', message: 'This reference has already been submitted.' });
        state.draft = { id: 'd-' + state.subs.length, body };
        return send(res, 200, { submission_id: state.draft.id, path: `k1/${user.id}/${state.draft.id}.webp`, token: 'upload-token' });
      }
      if (fn === 'confirm-submission') {
        const d = state.draft;
        state.subs.unshift({ id: d.id, category_id: d.body.category_id, category_name: state.cats.find((c) => c.id === d.body.category_id)?.name, category_points: 1, reference: d.body.reference,
          note: d.body.note, status: 'pending', attempt: d.body.resubmission_of ? 2 : 1, resubmission_of: d.body.resubmission_of, points_awarded: null, reject_reason_code: null, reject_reason_text: null,
          proof_path: `k1/${user.id}/${d.id}.webp`, created_at: iso(0), submitted_at: iso(0), reviewed_at: null, can_resubmit: false, resubmit_block: null });
        return send(res, 200, { ok: true });
      }
      if (fn === 'contest-export') return send(res, 200, { marked: true, standings_csv: 'rank,display_name\r\n1,Cy\r\n', audit_csv: 'id,action\r\n1,x\r\n' });
      if (fn === 'admin-manage') return send(res, 200, { ok: true });
      return send(res, 404, { error: 'not_found', message: 'no such function' });
    }

    // ---- Storage
    if (p.startsWith('/storage/v1/object/sign/proofs') && req.method === 'POST') {
      return send(res, 200, (body.paths ?? []).map((path) => ({ path, signedURL: `/object/sign/proofs/${path}?token=t`, error: null })));
    }
    if (p.startsWith('/storage/v1/object/sign/proofs/')) return send(res, 200, SHOT_SVG, 'image/svg+xml');
    if (p.startsWith('/storage/v1/object/upload/sign/proofs/') && state.failUploads > 0) { state.failUploads--; return send(res, 500, { message: 'simulated upload failure' }); }
    if (p.startsWith('/storage/v1/object/upload/sign/proofs/')) {
      // supabase-js sends multipart/form-data: pull out the file part (its own Content-Type and bytes)
      const text = rawBuf.toString('latin1');
      const m = /Content-Type: (image\/[a-z+.-]+)\r\n\r\n/.exec(text);
      let type = m?.[1] ?? req.headers['content-type'], bytes = rawBuf.length, head = '';
      if (m) {
        const start = m.index + m[0].length;
        const end = text.lastIndexOf('\r\n------');
        bytes = end - start;
        head = rawBuf.subarray(start, start + 16).toString('hex');
      }
      state.uploaded.push({ path: p, type, bytes, head });
      return send(res, 200, { Key: p });
    }

    // ---- RPC
    const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(p);
    if (rpc) {
      const fn = rpc[1];
      if (!user) return send(res, 401, { code: 'PGRST301', message: 'JWT required' });
      if (fn === 'get_contest_banner') return send(res, 200, [banner()]);
      if (fn === 'get_leaderboard') return send(res, 200, state.board.map(({ title, ...r }) => ({ ...r, is_me: user.kind === 'member' ? r.is_me : false })));
      if (fn === 'my_submissions') return send(res, 200, state.subs);
      if (fn === 'get_admin_leaderboard') return send(res, 200, state.board.map((r, i) => ({ member_id: 'm' + i, email: r.display_name.toLowerCase() + '@x.test', display_name: r.display_name, title: r.title, points: r.points,
        tasks_completed: r.tasks_completed, rank: r.rank, reached_at: r.reached_at, pending_count: i === 1 ? 1 : 0, active: r.display_name !== 'Alpha' })));
      if (fn === 'claim_submission') return send(res, 200, { mine: true, claimed_by: user.id, claimed_until: iso(5) });
      if (['approve_submission', 'reject_submission'].includes(fn)) {
        if (body.p_id === 'q-taken') return send(res, 400, { code: 'P0001', message: 'already_reviewed: This submission was already reviewed.' });
        state.pending = state.pending.filter((s) => s.id !== body.p_id);
        return send(res, 200, null);
      }
      if (fn === 'withdraw_submission') { state.subs = state.subs.filter((s) => s.id !== body.p_id); return send(res, 200, null); }
      if (['set_points_unlocked', 'extend_deadline', 'publish_final', 'reopen_contest', 'upsert_category', 'set_category_active', 'reverse_submission', 'correct_rejection', 'grant_override'].includes(fn)) {
        state.calls.push('RPC ' + fn + ' ' + JSON.stringify(body));
        return send(res, 200, null);
      }
      return send(res, 404, { code: 'PGRST202', message: 'unknown rpc ' + fn });
    }

    // ---- Tables
    const tbl = /^\/rest\/v1\/([a-z_]+)$/.exec(p);
    if (tbl) {
      const t = tbl[1];
      const eq = (k) => { const v = url.searchParams.get(k); return v?.startsWith('eq.') ? v.slice(3) : null; };
      if (!user) return send(res, 401, { code: 'PGRST301', message: 'JWT required' });
      if (t === 'admins') {
        const id = eq('id');
        const rows = Object.values(users).filter((u) => u.kind === 'admin').map((u) => ({ id: u.id, email: u.email, role: u.role, active: true, created_at: iso(-9000) }));
        return send(res, 200, id ? rows.filter((r) => r.id === id) : rows);
      }
      if (t === 'members') {
        const id = eq('id');
        const rows = [{ id: users.member.id, display_name: 'Maya (member)', title: 'HubSpot Specialist', active: true, email: 'member@x.test' }, { id: 'm1', display_name: 'Ben', active: true, email: 'ben@x.test' }];
        return send(res, 200, id ? rows.filter((r) => r.id === id) : rows);
      }
      if (t === 'categories') return send(res, 200, state.cats);
      if (t === 'contests') return send(res, 200, [{ id: 'k1', name: 'Fall Contest', start_at: iso(-1440), end_at: iso(1440), grace_minutes: 10, manual_status: 'setup', points_unlocked: false, finalized_at: null, results_updated_at: null, exported_at: null }]);
      if (t === 'audit_log') return send(res, 200, [{ id: 2, created_at: iso(-5), actor_type: 'admin', actor_id: users.admin.id, action: 'submission.approved', entity: 'submissions', entity_id: 's-ok', reason: null, before: { status: 'pending' }, after: { status: 'approved' } }]);
      if (t === 'submissions') {
        const id = eq('id');
        if (eq('status') === 'pending') return send(res, 200, state.pending);
        if (id) return send(res, 200, [...state.pending, { ...state.pending[1], id: 's-rej', attempt: 1, status: 'rejected', reject_reason_code: 'unclear_screenshot', reject_reason_text: 'Cannot read the title', proof_path: 'p/rej.png' }].filter((s) => s.id === id));
        if (eq('member_id')) return send(res, 200, state.subs.map((s) => ({ ...s, override_granted: false, flags: [], category: { name: s.category_name } })));
        return send(res, 200, []);
      }
      return send(res, 200, []);
    }
    return send(res, 404, { message: 'mock: ' + req.method + ' ' + p });
  });

  return {
    state, users,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = createMock();
  await m.listen(Number(process.env.PORT ?? 54321));
  console.log('mock supabase on', process.env.PORT ?? 54321);
}
