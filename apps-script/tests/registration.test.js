'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./harness');

const NEXT = 6 * 60 * 1000; // for time-travel helpers

test('registration: creates the auth user + member, writes the Sheet, emails the key', () => {
  const e = makeEnv();
  const row = e.submit({ email: ' Jane@Example.com ', displayName: 'jane doe' });

  // Supabase side
  assert.equal(e.sb.members.length, 1);
  assert.equal(e.sb.members[0].email, 'jane@example.com');
  assert.equal(e.sb.members[0].display_name, 'Jane Doe');
  assert.equal(e.sb.users.size, 1);
  assert.equal(e.sb.members[0].id, [...e.sb.users.keys()][0], 'members.id = auth user id');

  // email: the key works as the password, however the member types it
  assert.equal(e.sent.length, 1);
  assert.equal(e.sent[0].to, 'jane@example.com');
  assert.equal(e.sent[0].subject, 'Your contest login key');
  const key = e.lastKey();
  assert.match(key, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(e.sb.login('jane@example.com', key));
  assert.ok(e.sb.login('JANE@example.com', key.toLowerCase().replace(/-/g, ' ')));
  assert.match(e.sent[0].body, /https:\/\/contest\.example\.com\/login/);
  assert.match(e.sent[0].body, /Keep this key private/);
  assert.match(e.sent[0].body, /Resend my key/);
  assert.match(e.sent[0].body, /help@example\.com/);

  // Sheet columns
  const s = e.sheet;
  assert.equal(s.val(row, 'Member ID'), e.sb.members[0].id);
  assert.equal(s.val(row, 'Key version'), 1);
  assert.ok(s.val(row, 'Key issued at') instanceof Date);
  assert.equal(s.val(row, 'Sync status'), 'OK');
  assert.ok(s.val(row, 'Last synced') instanceof Date);
  assert.equal(s.val(row, 'Email status'), 'Sent');
  assert.equal(s.val(row, 'Active'), true);
  assert.match(s.val(row, 'Synced fingerprint'), /^[0-9a-f]{16}\|[0-9a-f]{16}\|1$/);

  // the Sheet never holds the key (or a hash of it)
  assert.ok(!s.allText().includes(key.replace(/-/g, '')));
  assert.ok(!JSON.stringify(e.state).includes(key.replace(/-/g, '')));
});

test('registering again with the same email rotates the key; the old key stops working', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com', displayName: 'Jane' });
  const oldKey = e.lastKey();
  const id = e.sb.members[0].id;
  assert.ok(e.sb.login('jane@example.com', oldKey));

  const row2 = e.submit({ email: 'JANE@example.com', displayName: 'Whatever' });
  const newKey = e.lastKey();
  assert.notEqual(newKey, oldKey);
  assert.equal(e.sb.members.length, 1, 'still one member');
  assert.equal(e.sb.members[0].id, id, 'Member ID kept');
  assert.equal(e.sb.members[0].display_name, 'Jane', 'display name unchanged');
  assert.equal(e.sb.members[0].key_version, 2);
  assert.equal(e.sb.login('jane@example.com', oldKey), false, 'old key rejected');
  assert.ok(e.sb.login('jane@example.com', newKey), 'new key works');
  assert.equal(e.sb.sessions.get(id), 0, 'sessions revoked');
  assert.equal(e.sheet.val(row2, 'Key version'), 2);
  assert.match(e.sent[1].body, /NEW contest login key/);
});

test('admin emails are rejected: no account, no email', () => {
  const e = makeEnv();
  e.sb.admins.push({ id: 'a1', email: 'boss@example.com' });
  const row = e.submit({ email: 'Boss@Example.com', displayName: 'Boss' });
  assert.equal(e.sheet.val(row, 'Sync status'), 'Admin email — rejected');
  assert.equal(e.sb.users.size, 0);
  assert.equal(e.sb.members.length, 0);
  assert.equal(e.sent.length, 0);
});

test('registration closes with the contest', () => {
  for (const status of ['closed', 'final', 'archived']) {
    const e = makeEnv();
    e.sb.status = status;
    const row = e.submit({ email: 'late@example.com' });
    assert.equal(e.sheet.val(row, 'Sync status'), 'Registration closed');
    assert.equal(e.sb.users.size, 0);
    assert.equal(e.sent.length, 0);
  }
  const e = makeEnv();
  e.sb.status = 'setup';
  e.submit({ email: 'early@example.com' });
  assert.equal(e.sb.members.length, 1, 'registration is open before the contest starts');
});

test('the Form is closed automatically once the contest closes', () => {
  const e = makeEnv();
  e.ctx.reconcile();
  assert.equal(e.form.accepting, true, 'stays open while the contest is open');
  e.sb.status = 'closed';
  e.ctx.reconcile();
  assert.equal(e.form.accepting, false);
});

test('taken display names get a number suffix, noted in the Sheet and the email', () => {
  const e = makeEnv();
  e.submit({ email: 'a@example.com', displayName: 'Alex' });
  const row = e.submit({ email: 'b@example.com', displayName: 'alex' });
  e.submit({ email: 'c@example.com', displayName: 'ALEX' });
  assert.deepEqual(e.sb.members.map(m => m.display_name), ['Alex', 'Alex 2', 'Alex 3']);
  assert.match(e.sheet.val(row, 'Notes'), /taken; using "Alex 2"/);
  assert.match(e.sent[1].body, /Alex 2/);
});

test('Supabase down: row marked failed, no email; the reconcile recovers it with a NEW key', () => {
  const e = makeEnv();
  e.sb.down = true;
  const row = e.submit({ email: 'jane@example.com', displayName: 'Jane' });
  assert.match(e.sheet.val(row, 'Sync status'), /^Failed: Supabase 503/);
  assert.equal(e.sent.length, 0);
  assert.equal(e.sb.users.size, 0);

  e.ctx.reconcile();                       // still down
  assert.match(e.sheet.val(row, 'Sync status'), /^Failed/);

  e.sb.down = false;
  e.ctx.reconcile();
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');
  assert.equal(e.sent.length, 1);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
});

test('retry after a failure is honoured even if the contest closed in the meantime', () => {
  const e = makeEnv();
  e.sb.down = true;
  const row = e.submit({ email: 'jane@example.com', timestamp: new Date(Date.now() - 3600e3) });
  e.sb.down = false;
  e.sb.status = 'closed';
  e.sb.contest.end_at = new Date(Date.now() - 60e3).toISOString();    // ended a minute ago, after she registered
  e.ctx.reconcile();
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');
  // but a registration made AFTER the end is not rescued
  e.sb.down = true;
  const row2 = e.submit({ email: 'late@example.com', timestamp: new Date() });
  e.sb.down = false;
  e.ctx.reconcile();
  assert.equal(e.sheet.val(row2, 'Sync status'), 'Registration closed');
});

test('half-finished earlier attempt (auth user exists, no member row) is adopted on retry', () => {
  const e = makeEnv();
  e.sb.users.set('orphan-id', { id: 'orphan-id', email: 'jane@example.com', password: 'OLDOLDOLD123', banned: false });
  const row = e.submit({ email: 'jane@example.com', displayName: 'Jane' });
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');
  assert.equal(e.sb.members[0].id, 'orphan-id');
  assert.equal(e.sb.login('jane@example.com', 'OLDOLDOLD123'), false);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
});

test('unticking Active bans the member; ticking it again restores access', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'jane@example.com', displayName: 'Jane' });
  const key = e.lastKey();
  const id = e.sb.members[0].id;
  const col = e.sheet.headers()['Active'];

  e.sheet.set(row, col, false);
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].active, false);
  assert.equal(e.sb.login('jane@example.com', key), false, 'banned: cannot log in');
  assert.equal(e.sb.sessions.get(id), 0, 'sessions revoked');
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');

  e.ctx.reconcile();                       // no further change
  assert.equal(e.sent.length, 1, 'no emails from deactivation');

  e.sheet.set(row, col, true);
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].active, true);
  assert.ok(e.sb.login('jane@example.com', key), 'unbanned: same key works again');
});

test('editing the display name in the Sheet is pushed (with uniqueness)', () => {
  const e = makeEnv();
  e.submit({ email: 'a@example.com', displayName: 'Alex' });
  const row = e.submit({ email: 'b@example.com', displayName: 'Bea' });
  e.sheet.set(row, e.sheet.headers()['Display name'], 'Alex');
  e.ctx.reconcile();
  assert.equal(e.sb.members[1].display_name, 'Alex 2');
  e.sheet.set(row, e.sheet.headers()['Display name'], 'Beatrice');
  e.ctx.reconcile();
  assert.equal(e.sb.members[1].display_name, 'Beatrice');
});

test('DB-side deactivation is not undone by the reconcile (only Sheet edits are pushed)', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  e.sb.members[0].active = false;           // an admin deactivated her in the website
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].active, false);
});

test('a deactivated member who registers again gets no key', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  e.sb.members[0].active = false;
  const row = e.submit({ email: 'jane@example.com' });
  assert.equal(e.sheet.val(row, 'Sync status'), 'Deactivated — no key sent');
  assert.equal(e.sent.length, 1);
});

test('email failure is recorded and the reconcile issues a fresh key', () => {
  const e = makeEnv();
  e.state.mailFails = true;
  const row = e.submit({ email: 'jane@example.com' });
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');
  assert.match(e.sheet.val(row, 'Email status'), /^Failed: mail service down/);
  e.state.mailFails = false;
  e.ctx.reconcile();
  assert.equal(e.sheet.val(row, 'Email status'), 'Sent');
  assert.equal(e.sb.members[0].key_version, 2);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
});

test('no email quota: nothing is rotated or created', () => {
  const e = makeEnv();
  e.state.mailQuota = 0;
  const row = e.submit({ email: 'jane@example.com' });
  assert.match(e.sheet.val(row, 'Sync status'), /^Failed: email quota/);
  assert.equal(e.sb.users.size, 0);
});

test('reconcile does not double-process a row the trigger is about to handle, but rescues missed ones', () => {
  const e = makeEnv();
  const fresh = e.sheet.addResponse({ email: 'new@example.com', timestamp: new Date() });          // trigger still pending
  const missed = e.sheet.addResponse({ email: 'old@example.com', timestamp: new Date(Date.now() - NEXT) });
  e.ctx.reconcile();
  assert.equal(e.sheet.val(fresh, 'Sync status'), '');
  assert.equal(e.sheet.val(missed, 'Sync status'), 'OK');
});

test('an already-handled row is not processed twice by the Form trigger', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'jane@example.com' });
  e.ctx.onFormSubmit({ range: { getRow: () => row, getSheet: () => e.sheet } });
  assert.equal(e.sent.length, 1);
  assert.equal(e.sb.members[0].key_version, 1);
});

test('members without a Sheet row are listed on an Orphans tab, never deleted', () => {
  const e = makeEnv();
  e.submit({ email: 'a@example.com', displayName: 'Ann' });
  e.sb.members.push({ id: 'ghost', contest_id: 'contest-1', email: 'ghost@example.com', display_name: 'Ghost', active: true, key_version: 1 });
  e.ctx.reconcile();
  const tab = e.orphansSheets['Orphans'];
  assert.equal(tab.get(2, 1), 'ghost');
  assert.equal(tab.get(2, 2), 'ghost@example.com');
  assert.equal(tab.getLastRow(), 2);
  assert.equal(e.sb.members.length, 2, 'nothing deleted');
});

test('invalid emails are rejected without calling Supabase', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'not-an-email' });
  assert.equal(e.sheet.val(row, 'Sync status'), 'Rejected: invalid email');
  assert.equal(e.sb.users.size, 0);
});

test('menu: resend key for selected row rotates; quota shown; close registration', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'jane@example.com' });
  const old = e.lastKey();
  e.ctx.onOpen();
  const items = e.state.menus[0][1].map(i => i[0]);
  assert.deepEqual(items.slice(0, 4), ['Sync selected row now', 'Sync all now', 'Resend key for selected row', 'Close registration now']);
  assert.match(items[4], /^Emails left today: 99$/);

  e.selectRow(row);
  e.ctx.menuResendSelected();
  assert.equal(e.sent.length, 2);
  assert.equal(e.sb.login('jane@example.com', old), false);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
  assert.equal(e.sheet.val(row, 'Key version'), 2);

  e.ctx.menuCloseRegistration();
  assert.equal(e.form.accepting, false);
});

test('installTriggers installs form-submit + 10-minute reconcile once', () => {
  const e = makeEnv();
  e.ctx.installTriggers(); e.ctx.installTriggers();
  assert.deepEqual(e.state.triggers.map(t => t.fn).sort(), ['onFormSubmit', 'reconcile']);
});

test('script-owned columns are appended to the right and form columns are untouched', () => {
  const e = makeEnv();
  const before = Object.keys(e.sheet.headers());
  e.submit({ email: 'jane@example.com' });
  const after = Object.keys(e.sheet.headers());
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length), ['Member ID', 'Key version', 'Key issued at', 'Sync status', 'Last synced', 'Email status', 'Active', 'Synced fingerprint', 'Notes']);
});

test('reconcile stops at its time budget instead of running into the 6-minute limit', () => {
  const e = makeEnv();
  const a = e.sheet.addResponse({ email: 'a@example.com', timestamp: new Date(Date.now() - NEXT) });
  const b = e.sheet.addResponse({ email: 'b@example.com', timestamp: new Date(Date.now() - NEXT) });
  e.ctx.RECONCILE_BUDGET_MS = -1;
  e.ctx.reconcile();
  assert.equal(e.sheet.val(a, 'Sync status'), '');
  assert.equal(e.sheet.val(b, 'Sync status'), '');
  e.ctx.RECONCILE_BUDGET_MS = 270000;
  e.ctx.reconcile();
  assert.equal(e.sheet.val(a, 'Sync status'), 'OK');
  assert.equal(e.sheet.val(b, 'Sync status'), 'OK');
});

test('title: collected from the Form, tidied, saved on the member; no title means none', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'a@example.com', displayName: 'Ann', title: '  HubSpot   Specialist ' });
  assert.equal(e.sb.members[0].title, 'HubSpot Specialist');
  assert.match(e.sheet.val(row, 'Synced fingerprint'), /^[0-9a-f]{16}\|[0-9a-f]{16}\|1$/);
  e.submit({ email: 'b@example.com', displayName: 'Ben' });
  assert.equal(e.sb.members[1].title, null);
  e.submit({ email: 'c@example.com', displayName: 'Cy', title: 'x'.repeat(200) });
  assert.equal(e.sb.members[2].title.length, 80);
});

test('title: editing it in the Sheet is pushed, clearing removes it, and unchanged rows cause no writes', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'a@example.com', displayName: 'Ann', title: 'Designer' });
  const col = e.sheet.headers()['Title'];
  const patches = () => e.sb.calls.filter((c) => c.startsWith('patch members')).length;
  e.ctx.reconcile();
  assert.equal(patches(), 0, 'nothing to push');
  e.sheet.set(row, col, 'Senior HubSpot Developer');
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].title, 'Senior HubSpot Developer');
  assert.equal(e.sheet.val(row, 'Sync status'), 'OK');
  e.sheet.set(row, col, '');
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].title, null);
  const before = patches();
  e.ctx.reconcile();
  assert.equal(patches(), before, 'stable afterwards');
});

test('title: a row synced by the older version (two-part fingerprint) gets its title pushed once', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'a@example.com', displayName: 'Ann' });
  const old = e.sheet.val(row, 'Synced fingerprint').split('|');
  e.sheet.set(row, e.sheet.headers()['Synced fingerprint'], old[0] + '|' + old[2]);   // name|active
  e.sheet.set(row, e.sheet.headers()['Title'], 'Zapier Builder');
  e.ctx.reconcile();
  assert.equal(e.sb.members[0].title, 'Zapier Builder');
  assert.match(e.sheet.val(row, 'Synced fingerprint'), /^[0-9a-f]{16}\|[0-9a-f]{16}\|1$/);
});

test('title: registering again with a new title updates it while the key rotates', () => {
  const e = makeEnv();
  e.submit({ email: 'a@example.com', displayName: 'Ann', title: 'Designer' });
  e.submit({ email: 'a@example.com', displayName: 'Ann', title: 'Design Lead' });
  assert.equal(e.sb.members[0].title, 'Design Lead');
  assert.equal(e.sb.members[0].key_version, 2);
  e.submit({ email: 'a@example.com', displayName: 'Ann' });    // no title this time: keep the one we have
  assert.equal(e.sb.members[0].title, 'Design Lead');
});

test('title: the Form question can be worded differently (e.g. "Professional title")', () => {
  const e = makeEnv();
  e.sheet.set(1, 5, 'Professional title (shown to teammates)');   // the Form's 5th column
  const row = e.sheet.addResponse({ email: 'a@example.com', displayName: 'Ann' });
  e.sheet.set(row, 5, 'Designer');
  e.ctx.onFormSubmit({ range: { getRow: () => row, getSheet: () => e.sheet } });
  assert.equal(e.sb.members[0].title, 'Designer');
});

test('title normalization', () => {
  const { ctx } = makeEnv();
  assert.equal(ctx.normalizeTitle_('  HubSpot   Specialist '), 'HubSpot Specialist');
  assert.equal(ctx.normalizeTitle_(null), '');
  assert.equal(ctx.normalizeTitle_('x'.repeat(100)).length, 80);
});
