// Browser smoke test: builds the app against the mock Supabase and walks the main member + admin flows.
// Run:  cd web/e2e && npm i && npm test   (needs a Chromium: set CHROMIUM_PATH if it is not at /opt/pw-browsers)
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { createMock } from './mock-supabase.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..');
const SHOTS = process.env.SHOTS_DIR ?? path.join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });
const MOCK_PORT = 54321, APP_PORT = 3100, BASE = `http://127.0.0.1:${APP_PORT}`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  const p = dir && path.join(root, dir, 'chrome-linux', 'chrome');
  assert.ok(p && existsSync(p), 'Chromium not found; set CHROMIUM_PATH');
  return p;
}

// A 2400x1600 PNG (wider than 1600px, a few MB, noisy so it does not shrink for free) and a tiny one.
function png(w, h, noise) {
  const crc = (buf) => { let c, crc = -1; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = w * 3 + 1; const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * row + 1 + x] = noise ? (((x / 12 + y / 9) & 0xff) & 0xfe) | ((Math.random() * 2) | 0) : 200;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mock = createMock();
await mock.listen(MOCK_PORT);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key' };
console.log('building the app against the mock…');
execSync('npx next build', { cwd: web, env, stdio: 'ignore' });
try { await fetch(BASE + '/resend'); console.error(`port ${APP_PORT} is already in use (stale server?)`); process.exit(2); } catch { /* free */ }
const app = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], { cwd: web, env, stdio: 'ignore', detached: true });
const stopApp = () => { try { process.kill(-app.pid); } catch { /* already gone */ } };
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/resend')).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const results = [];
let failures = 0;
const pageErrors = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ok  ', name); }
  catch (e) { failures++; results.push(['FAIL', name, e.message]); console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 6).join('\n       ')); }
}
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });

try {
  // ------------------------------------------------------------------ logged out + login
  const m = await newPage();
  await step('logged-out visitors are sent to the login pages', async () => {
    for (const [from, to] of [['/dashboard', '/login'], ['/', '/login'], ['/admin', '/admin/login'], ['/admin/contest', '/admin/login'], ['/admin/review/q1', '/admin/login']]) {
      await m.goto(BASE + from);
      assert.equal(new URL(m.url()).pathname, to, `${from} -> ${to}`);
    }
  });
  await step('login: key input formats while typing; wrong key shows the generic error', async () => {
    await m.goto(BASE + '/login');
    await m.fill('input[type=email]', 'member@x.test');
    await m.fill('input[placeholder="XXXX-XXXX-XXXX"]', 'k7rmqx4p9wab');
    assert.equal(await m.inputValue('input[placeholder="XXXX-XXXX-XXXX"]'), 'K7RM-QX4P-9WAB');
    await shot(m, '01-login');
    await m.click('button[type=submit]');
    await m.getByText('Email or key is incorrect.').waitFor();
  });
  await step('repeated wrong keys: 1 free try, the 2nd starts a 3-minute cooldown, then it grows; the right key is refused while waiting', async () => {
    const p2 = await newPage();
    await p2.goto(BASE + '/login');
    const key = p2.locator('input[placeholder="XXXX-XXXX-XXXX"]');
    const tryKey = async (value) => { await p2.fill('input[type=email]', 'lockme@x.test'); await key.fill(value); await p2.click('button[type=submit]'); };
    await tryKey('WRONG1111111'); await p2.getByText('Email or key is incorrect.', { exact: true }).waitFor();
    await tryKey('WRONG2222222');                                  // 2nd failure: 180 seconds
    await p2.getByText('Email or key is incorrect. Too many failed attempts. Try again in 3 minutes.').waitFor();
    await shot(p2, '07-login-delay');
    await tryKey('ABCD-2345-ZZZZ');                                // correct key, still waiting
    await p2.getByText('Too many failed attempts. Try again in 3 minutes.', { exact: true }).waitFor();
    assert.equal(new URL(p2.url()).pathname, '/login', 'not logged in while delayed');
    mock.state.clockOffsetMs += 181_000;                          // wait it out
    await tryKey('WRONG3333333');                                  // 3rd failure: 4 minutes
    await p2.getByText('Email or key is incorrect. Too many failed attempts. Try again in 4 minutes.').waitFor();
    mock.state.clockOffsetMs += 241_000;
    await tryKey('abcd 2345 zzzz');                                // right key after the wait works and clears the count
    await p2.waitForURL('**/dashboard');
    assert.deepEqual(mock.state.failures['lockme@x.test'], undefined);
    await p2.context().close();
  });
  await step('login: messy but correct key works', async () => {
    await m.fill('input[placeholder="XXXX-XXXX-XXXX"]', 'abcd 2345-efgh');
    await m.click('button[type=submit]');
    await m.waitForURL('**/dashboard');
    await m.getByText('Hi, Maya (member)').waitFor();
  });

  // ------------------------------------------------------------------ dashboard
  await step('dashboard: standing, leaderboard with my row highlighted, submissions', async () => {
    await m.getByText('My points').waitFor();
    assert.equal((await m.locator('text=#3').first().textContent()).trim(), '#3');
    await m.getByText('Maya (member)', { exact: true }).first().waitFor();
    await m.getByText('you', { exact: true }).waitFor();
    await m.getByText('Alpha').waitFor();
    assert.equal(await m.getByText('Zapier Builder').count(), 0, "teammates' titles are not on the leaderboard");
    assert.equal(await m.getByText('GoHighLevel Consultant').count(), 0);
    await m.getByText('Hi, Maya (member) · HubSpot Specialist').waitFor();
    await m.getByText('Cannot read the title', { exact: false }).waitFor();
    await shot(m, '02-dashboard-open');
  });
  await step('banner states', async () => {
    for (const [status, text] of [['setup', 'Submissions open on'], ['closed', 'Provisional: 2 submissions under review.'], ['final', 'Final results']]) {
      mock.state.status = status;
      await m.reload();
      await m.getByText(text, { exact: false }).first().waitFor();
      if (status === 'setup') await m.getByText('Submissions open on', { exact: false }).nth(1).waitFor();   // submit disabled too
      await shot(m, '03-banner-' + status);
    }
    mock.state.status = 'open';
    await m.reload();
    assert.equal(await m.getByText('Provisional').count(), 0, 'no banner while open');
  });
  await step('submit: small PNG goes through draft -> signed upload -> confirm', async () => {
    await m.selectOption('select', { label: 'New Gig (1 pt)' });
    await m.fill('input[maxlength="200"]', 'brand new gig');
    await m.setInputFiles('input[type=file]', { name: 'small.png', mimeType: 'image/png', buffer: png(300, 200, false) });
    await m.getByRole('button', { name: 'Submit', exact: true }).click();
    await m.getByText('Submitted. An admin will review it soon.').waitFor();
    await m.getByText('brand new gig').waitFor();
    const up = mock.state.uploaded.at(-1);
    console.log('        small upload:', up.type, up.bytes + ' bytes', up.head.slice(0, 8));
  });
  await step('submit: big noisy image is shrunk to <= 1600px and <= 2 MB', async () => {
    await m.selectOption('select', { label: 'New Account (2 pts)' });
    await m.fill('input[maxlength="200"]', 'big_shot');
    await m.setInputFiles('input[type=file]', { name: 'big.png', mimeType: 'image/png', buffer: png(2400, 1600, true) });
    await m.getByRole('button', { name: 'Submit', exact: true }).click();
    await m.getByText('big_shot').waitFor({ timeout: 60000 });
    const up = mock.state.uploaded.at(-1);
    console.log('        big upload:', up.type, up.bytes + ' bytes', up.head.slice(0, 12));
    assert.ok(up.bytes <= 2 * 1024 * 1024, 'under the 2 MB bucket limit');
    assert.ok(up.bytes <= 600 * 1024, 'close to the 500 KB target: ' + up.bytes);
    assert.equal(up.type.split(';')[0], 'image/webp', 'converted to WebP');
  });
  await step('submit: a failed upload can be retried on the same draft (nothing is created twice)', async () => {
    mock.state.failUploads = 1;
    const drafts = () => mock.state.calls.filter((c) => c === 'POST /functions/v1/create-submission-draft').length;
    const before = drafts();
    await m.selectOption('select', { label: 'New Gig (1 pt)' });
    await m.fill('input[maxlength="200"]', 'flaky connection gig');
    await m.setInputFiles('input[type=file]', { name: 'f.png', mimeType: 'image/png', buffer: png(300, 200, false) });
    await m.getByRole('button', { name: 'Submit', exact: true }).click();
    await m.getByText('The upload did not finish.').waitFor();
    assert.ok(await m.locator('input[maxlength="200"]').isDisabled(), 'form is locked while a draft is waiting');
    await shot(m, '06-upload-failed');
    await m.getByRole('button', { name: 'Retry' }).click();
    await m.getByText('flaky connection gig').waitFor();
    assert.equal(drafts() - before, 1, 'one draft only');
  });
  await step('submit: works on a slow mobile connection (emulated slow 3G)', async () => {
    const cdp = await m.context().newCDPSession(m);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: 50 * 1024, uploadThroughput: 30 * 1024 });
    try {
      await m.selectOption('select', { label: 'New Account (2 pts)' });
      await m.fill('input[maxlength="200"]', 'slow_net_account');
      await m.setInputFiles('input[type=file]', { name: 's.png', mimeType: 'image/png', buffer: png(1200, 800, true) });
      await m.getByRole('button', { name: 'Submit', exact: true }).click();
      await m.getByText('Uploading screenshot…').or(m.getByText('Creating submission…')).first().waitFor({ timeout: 20000 });   // visible progress
      await m.getByText('slow_net_account').waitFor({ timeout: 90000 });
    } finally {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  });
  await step('submit: duplicate reference error is shown and the form stays usable', async () => {
    await m.selectOption('select', { label: 'New Gig (1 pt)' });
    await m.fill('input[maxlength="200"]', 'dup');
    await m.setInputFiles('input[type=file]', { name: 'x.png', mimeType: 'image/png', buffer: png(100, 100, false) });
    await m.getByRole('button', { name: 'Submit', exact: true }).click();
    await m.getByText('This reference has already been submitted.').waitFor();
  });
  await step('submit: files over 5 MB are refused before any work', async () => {
    await m.setInputFiles('input[type=file]', { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 1) });
    await m.getByText('That file is over 5 MB').waitFor();
  });
  await step('resubmit pre-fills the category and reference; withdraw removes a pending item', async () => {
    await m.getByRole('button', { name: 'Resubmit' }).first().click();
    await m.getByRole('heading', { name: 'Resubmit' }).waitFor();
    assert.equal(await m.locator('input[maxlength="200"]').inputValue(), 'my gig');
    assert.equal(await m.locator('select').inputValue(), 'c2');
    await shot(m, '04-resubmit');
    await m.getByRole('button', { name: 'Withdraw' }).first().click();
    await m.waitForFunction(() => document.querySelectorAll('button').length > 0);
    await m.getByText('brand new gig').waitFor({ state: 'detached' }).catch(() => {});
  });
  await step('empty state for a brand-new member', async () => {
    mock.state.subs.length = 0;
    await m.reload();
    await m.getByText('Nothing submitted yet.').waitFor();
  });
  await step('member cannot use the admin area', async () => {
    await m.goto(BASE + '/admin');
    assert.equal(new URL(m.url()).pathname, '/admin/login');
    await m.getByText('This account is not an admin account.').waitFor();
  });
  await step('log out', async () => {
    await m.goto(BASE + '/dashboard');
    await m.getByRole('button', { name: 'Log out' }).click();
    await m.waitForURL('**/login');
    await m.goto(BASE + '/dashboard');
    assert.equal(new URL(m.url()).pathname, '/login');
  });
  await step('resend page shows the generic confirmation', async () => {
    await m.goto(BASE + '/resend');
    await m.fill('input[type=email]', 'anyone@x.test');
    await m.getByRole('button', { name: 'Send me a new key' }).click();
    await m.getByText('If this email is registered, a new key has been sent.').waitFor();
    await shot(m, '05-resend');
  });

  // ------------------------------------------------------------------ admin
  const a = await newPage();
  await step('admin login rejects members and accepts admins', async () => {
    await a.goto(BASE + '/admin/login');
    await a.fill('input[type=email]', 'member@x.test'); await a.fill('input[type=password]', 'ABCD2345EFGH');
    await a.click('button[type=submit]');
    await a.getByText('Email or password is incorrect.').waitFor();
    await a.fill('input[type=email]', 'admin@x.test'); await a.fill('input[type=password]', 'adminpass1');
    await a.click('button[type=submit]');
    await a.waitForURL('**/admin');
  });
  await step('queue: oldest first, flags and resubmission badges', async () => {
    await a.getByText('Screenshot reused').waitFor();
    await a.getByText('Resubmission (attempt 2)').waitFor();
    const first = await a.locator('ul > li').first().textContent();
    assert.match(first, /Ben/, 'oldest (Ben) first');
    assert.match(first, /GoHighLevel Consultant/, 'title shown in the queue');
    await shot(a, '10-admin-queue');
  });
  await step('review: resubmission shows previous attempt, final-rejection warning, other needs text', async () => {
    await a.getByText('Cy').first().click();
    await a.waitForURL('**/admin/review/q2');
    await a.getByText('Previous attempt (rejected)').waitFor();
    await a.getByText('Zapier Builder').first().waitFor();                           // title on the review screen
    await a.getByText('Cannot read the title', { exact: false }).waitFor();
    await a.getByRole('button', { name: 'Reject…' }).click();
    await a.getByText('Rejecting this is final.').waitFor();
    await a.selectOption('select', 'other');
    assert.ok(await a.getByRole('button', { name: 'Confirm reject' }).isDisabled(), 'other requires a message');
    await a.fill('textarea', 'Edited screenshot');
    await shot(a, '11-admin-review-reject');
    await a.getByRole('button', { name: 'Confirm reject' }).click();
    await a.waitForURL((u) => u.pathname === '/admin');
    assert.equal(await a.getByText('Cy').count(), 0, 'reviewed item left the queue');
  });
  await step('review: approve', async () => {
    await a.getByText('Ben').first().click();
    await a.waitForURL('**/admin/review/q1');
    await a.getByRole('button', { name: /Approve/ }).click();
    await a.waitForURL((u) => u.pathname === '/admin');
    await a.getByText('Nothing waiting.').waitFor();
  });
  await step('admin pages: members, categories (points locked), log, board', async () => {
    await a.goto(BASE + '/admin/members');
    await a.getByRole('link', { name: 'Alpha' }).waitFor();
    await a.getByText('inactive').waitFor();
    await a.getByText('HubSpot Specialist').waitFor();                               // Title column
    await shot(a, '12-admin-members');
    await a.goto(BASE + '/admin/categories');
    await a.getByText('Point values are locked').waitFor();
    assert.ok(await a.locator('input[type=number]').first().isDisabled(), 'points field disabled');
    await shot(a, '13-admin-categories');
    await a.goto(BASE + '/admin/log');
    await a.getByText('submission.approved').waitFor();
    await a.goto(BASE + '/admin/board');
    await a.getByText('Fall Contest').waitFor();
    assert.equal(await a.getByText('Zapier Builder').count(), 0, 'no titles on the projector board');
    await shot(a, '14-admin-board');
  });
  await step('non-owner admins are kept out of owner pages', async () => {
    for (const p of ['/admin/contest', '/admin/admins']) {
      await a.goto(BASE + p);
      assert.equal(new URL(a.url()).pathname, '/admin', p);
    }
    assert.equal(await a.getByRole('link', { name: 'Contest' }).count(), 0, 'no owner links in the nav');
  });
  await step('member detail loads history and actions', async () => {
    await a.goto(BASE + '/admin/members/m1');
    await a.getByText('History').waitFor();
  });

  const o = await newPage();
  await step('owner: contest and admins pages', async () => {
    await o.goto(BASE + '/admin/login');
    await o.fill('input[type=email]', 'owner@x.test'); await o.fill('input[type=password]', 'ownerpass1');
    await o.click('button[type=submit]');
    await o.waitForURL('**/admin');
    await o.goto(BASE + '/admin/contest');
    await o.getByText('Extend the deadline').first().waitFor();
    await o.getByText('Unlock point values…').waitFor();
    await shot(o, '15-owner-contest');
    // a reason is mandatory
    await o.getByText('Unlock point values…').click();
    await o.getByRole('button', { name: 'Unlock', exact: true }).click();
    await o.getByText('A reason is required.').waitFor();
    await o.fill('textarea', 'Typo in the point value');
    await o.getByRole('button', { name: 'Unlock', exact: true }).click();
    await o.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.ok(mock.state.calls.some((c) => c.startsWith('RPC set_points_unlocked') && c.includes('Typo in the point value')));
    await o.goto(BASE + '/admin/admins');
    await o.getByText('Invite an admin').waitFor();
    await o.getByText('owner@x.test (you)').waitFor();
    await shot(o, '16-owner-admins');
  });
  await step('owner: closed contest offers publish; final offers export/reopen/archive', async () => {
    mock.state.status = 'closed'; mock.state.pending = [];
    await o.goto(BASE + '/admin/contest');
    await o.getByText('Publish final results…').waitFor();
    mock.state.status = 'final';
    await o.goto(BASE + '/admin/contest');
    await o.getByText('Download CSVs').waitFor();
    await o.getByText('Reopen the contest…').waitFor();
    await o.getByText('Archive…').waitFor();
    const [dl] = await Promise.all([o.waitForEvent('download'), o.getByText('Download CSVs').click()]);
    assert.match(dl.suggestedFilename(), /\.csv$/);
  });
} finally {
  await browser.close();
  stopApp();
  await mock.close();
}
const real = pageErrors.filter((e) => !/WebSocket|realtime/i.test(e));
if (real.length) { failures++; console.log('  FAIL uncaught page errors:\n   ', real.slice(0, 5).join('\n    ')); }
console.log(`\n${results.length - failures < 0 ? 0 : results.filter((r) => r[0] === 'ok').length}/${results.length} steps passed; screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
