// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { normalizeKey } from '../_shared/key.ts';
import { handle, waitText } from './handler.ts';

const session = { access_token: 'at', refresh_token: 'rt' };
function setup(o: {
  check?: any;
  record?: any;
  recordError?: string;
  recordThrow?: boolean;
  signIn?: any;
  env?: Record<string, string>;
} = {}) {
  return fakeDeps({
    env: o.env,
    admin: {
      rpc: {
        login_check: () => ({ data: o.check ?? { locked: false } }),
        login_record: () => {
          if (o.recordThrow) throw new Error('login record connection failed');
          if (o.recordError) return { error: { message: o.recordError, code: 'XX000' } };
          return { data: o.record ?? { locked: false } };
        },
      },
    },
    anon: { signIn: o.signIn ?? (() => ({ session })) },
  });
}
const body = (extra: any = {}) => ({ email: ' Maya@Example.com ', password: 'k7rm-qx4p 9wab', mode: 'member', ...extra });
const names = (f: ReturnType<typeof setup>) => f.calls.map((c) => c.name);

Deno.test('key normalization matches Apps Script and the website', () => {
  assertEquals(normalizeKey('k7rm-qx4p 9wab'), 'K7RMQX4P9WAB');
  assertEquals(normalizeKey(null), '');
});

Deno.test('success: signs in with the normalized key, clears the failures, returns only the tokens', async () => {
  const f = setup();
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { session });
  assertEquals(f.calls.find((c) => c.name === 'auth.signInWithPassword')!.args[0], { email: 'maya@example.com', password: 'K7RMQX4P9WAB' });
  assertEquals(f.calls.find((c) => c.name === 'rpc:login_record')!.args[0], { p_email: 'maya@example.com', p_success: true });
});

Deno.test('admin mode sends the password exactly as typed', async () => {
  const f = setup();
  await handle(post(body({ mode: 'admin', password: 'My-Pass word1' }), null), f.deps);
  assertEquals(f.calls.find((c) => c.name === 'auth.signInWithPassword')!.args[0].password, 'My-Pass word1');
});

Deno.test('wrong key: generic 401 and the failure is recorded', async () => {
  const f = setup({ signIn: () => ({ error: { message: 'Invalid login credentials', status: 400 } }) });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 401);
  assertEquals((await res.json()).message, 'Email or key is incorrect.');
  assertEquals(f.calls.find((c) => c.name === 'rpc:login_record')!.args[0], { p_email: 'maya@example.com', p_success: false });
});

Deno.test('the failure that triggers a delay says so (and still hides what was wrong)', async () => {
  const f = setup({ signIn: () => ({ error: { message: 'x', status: 400 } }), record: { locked: true, retry_after_seconds: 60 } });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 429);
  const j = await res.json();
  assertEquals(j.error, 'locked');
  assertEquals(j.message, 'Email or key is incorrect. Too many failed attempts. Try again in 1 minute.');
});

Deno.test('login fails closed and logs an explicit error if failure recording fails', async () => {
  const f = setup({
    recordError: 'database unavailable',
    signIn: () => ({ error: { message: 'Invalid login credentials', status: 400 } }),
  });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 500);
  const response = await res.json();
  assertEquals(response.error, 'internal');
  assertEquals(response.message, 'Could not record the failed login attempt. Please try again.');

  const thrown = setup({ recordThrow: true, signIn: () => ({ error: { message: 'bad credentials', status: 400 } }) });
  assertEquals((await handle(post(body(), null), thrown.deps)).status, 500);
});

Deno.test('does not return a valid session if successful-login throttle reset fails', async () => {
  const f = setup({ recordError: 'database unavailable' });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), {
    error: 'internal',
    message: 'Login succeeded, but the throttling state could not be cleared. Please try again.',
  });
});

Deno.test('while delayed, the password is never even checked, so a correct key does not help', async () => {
  const f = setup({ check: { locked: true, retry_after_seconds: 125 } });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 429);
  const j = await res.json();
  assertEquals(j.retry_after_seconds, 125);
  assertEquals(j.message, 'Too many failed attempts. Try again in 3 minutes.');
  assert(!names(f).includes('auth.signInWithPassword'));
  assert(!names(f).includes('rpc:login_record'), 'blocked attempts do not extend the delay');
});

Deno.test('Supabase network rate limit is reported without counting a failure', async () => {
  const f = setup({ signIn: () => ({ error: { message: 'rate limit', status: 429 } }) });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, 'rate_limited');
  assert(!names(f).includes('rpc:login_record'));
});

Deno.test('with the Auth hook enabled the function does not record attempts a second time', async () => {
  const bad = setup({ env: { LOGIN_THROTTLE_HOOK: 'on' }, signIn: () => ({ error: { message: 'x', status: 400 } }) });
  assertEquals((await handle(post(body(), null), bad.deps)).status, 401);
  assert(!names(bad).includes('rpc:login_record'));
  const ok = setup({ env: { LOGIN_THROTTLE_HOOK: 'on' } });
  assertEquals((await handle(post(body(), null), ok.deps)).status, 200);
  assert(!names(ok).includes('rpc:login_record'));
});

Deno.test('fails closed when the delay state cannot be read', async () => {
  const f = fakeDeps({ admin: { rpc: { login_check: () => ({ error: { message: 'db down' } }) } }, anon: { signIn: () => ({ session }) } });
  const res = await handle(post(body(), null), f.deps);
  assertEquals(res.status, 500);
  assert(!f.calls.some((c) => c.name === 'auth.signInWithPassword'));
});

Deno.test('bad input', async () => {
  const f = setup();
  for (const b of [{}, { email: 'a@b.c' }, body({ mode: 'root' }), body({ password: 5 }), 'garbage']) {
    assertEquals((await handle(post(b as any, null), f.deps)).status, 400);
  }
  for (const b of [body({ email: 'not-an-email' }), body({ password: '' }), body({ password: 'x'.repeat(300) })]) {
    const r = await handle(post(b, null), f.deps);
    assertEquals(r.status, 401);
  }
  assertEquals(f.calls.length, 0, 'nothing touched the database or Auth');
  assertEquals((await handle(new Request('https://x.test', { method: 'GET' }), f.deps)).status, 405);
});

Deno.test('wait text', () => {
  assertEquals(waitText(1), '1 minute');
  assertEquals(waitText(60), '1 minute');
  assertEquals(waitText(61), '2 minutes');
});
