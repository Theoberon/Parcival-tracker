// Captures the main screens (phone + desktop) against the mock Supabase for a visual preview.
//   SHOTS_DIR=./preview node preview.mjs
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createMock } from './mock-supabase.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..');
const OUT = process.env.SHOTS_DIR ?? path.join(here, 'preview');
mkdirSync(OUT, { recursive: true });
const MOCK = 54321, APP = 3100, BASE = `http://127.0.0.1:${APP}`;
const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const exe = process.env.CHROMIUM_PATH ?? path.join(root, readdirSync(root).find((d) => /^chromium-\d+$/.test(d)), 'chrome-linux', 'chrome');
if (!existsSync(exe)) throw new Error('Chromium not found');

const mock = createMock();
await mock.listen(MOCK);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key' };
execSync('npx next build', { cwd: web, env, stdio: 'ignore' });
const app = spawn('npx', ['next', 'start', '-p', String(APP)], { cwd: web, env, stdio: 'ignore', detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/resend')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

const SIZES = { phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } };
async function session(kind, who) {
  const ctx = await browser.newContext(SIZES[kind]);
  const page = await ctx.newPage();
  if (who) {
    const admin = who !== 'member';
    await page.goto(BASE + (admin ? '/admin/login' : '/login'));
    await page.fill('input[type=email]', `${who}@x.test`);
    await page.fill(admin ? 'input[type=password]' : 'input[placeholder="XXXX-XXXX-XXXX"]', who === 'member' ? 'ABCD2345EFGH' : who === 'admin' ? 'adminpass1' : 'ownerpass1');
    await page.click('button[type=submit]');
    await page.waitForURL(admin ? '**/admin' : '**/dashboard');
  }
  return { ctx, page };
}
const snap = async (page, name, full = true) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 82, fullPage: full }); console.log('shot', name); };

try {
  for (const kind of ['phone', 'desktop']) {
    // logged out
    let { ctx, page } = await session(kind);
    await page.goto(BASE + '/login'); await page.fill('input[type=email]', 'maya@example.com'); await page.fill('input[placeholder="XXXX-XXXX-XXXX"]', 'k7rmqx4p9wab');
    await snap(page, `${kind}-login`, false); await ctx.close();

    // member
    ({ ctx, page } = await session(kind, 'member'));
    await page.getByText('Leaderboard').waitFor();
    await snap(page, `${kind}-dashboard`);
    mock.state.status = 'closed'; await page.reload(); await page.getByText('Provisional').waitFor(); await snap(page, `${kind}-dashboard-closed`);
    mock.state.status = 'open';
    await ctx.close();

    // admin
    ({ ctx, page } = await session(kind, 'admin'));
    await page.getByText('Review queue').waitFor(); await snap(page, `${kind}-admin-queue`);
    await page.goto(BASE + '/admin/review/q2'); await page.getByText('Previous attempt (rejected)').waitFor(); await page.waitForTimeout(500);
    await snap(page, `${kind}-admin-review`);
    await page.goto(BASE + '/admin/members'); await page.getByRole('link', { name: 'Alpha' }).waitFor(); await snap(page, `${kind}-admin-members`);
    await page.goto(BASE + '/admin/categories'); await page.getByText('Point values are locked').waitFor(); await snap(page, `${kind}-admin-categories`);
    await page.goto(BASE + '/admin/log'); await page.getByText('submission.approved').waitFor(); await snap(page, `${kind}-admin-log`);
    await ctx.close();

    // owner
    ({ ctx, page } = await session(kind, 'owner'));
    await page.goto(BASE + '/admin/contest'); await page.getByText('Extend the deadline').first().waitFor(); await snap(page, `${kind}-owner-contest`);
    await page.goto(BASE + '/admin/admins'); await page.getByText('Invite an admin').waitFor(); await snap(page, `${kind}-owner-admins`);
    await page.goto(BASE + '/admin/board'); await page.getByText('Fall Contest').waitFor(); await snap(page, `${kind}-board`, false);
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-app.pid); } catch { /* gone */ }
  await mock.close();
}
