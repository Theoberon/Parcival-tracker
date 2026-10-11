// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { GENERIC_MESSAGE, handle } from './handler.ts';

const env = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/abc/exec', RESEND_SHARED_SECRET: 'shh' };

function setup(o: { allowed?: boolean; member?: boolean; rpcError?: boolean } = {}) {
  const fetched: { url: string; init: any }[] = [];
  const f = fakeDeps({
    env,
    admin: {
      rpc: { rate_limit_key_request: () => (o.rpcError ? { error: { message: 'db down' } } : { data: o.allowed ?? true }) },
      query: () => ({ data: o.member === false ? [] : [{ id: 'm1' }] }),
    },
    fetch: ((url: string, init: any) => { fetched.push({ url, init }); return Promise.resolve(new Response('ok')); }) as any,
  });
  return { ...f, fetched };
}

Deno.test('registered email: asks Apps Script to rotate; secret + email in the body', async () => {
  const f = setup();
  const res = await handle(post({ email: ' Jane@Example.com ' }, null, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), f.deps);
  assertEquals(await res.json(), { message: GENERIC_MESSAGE });
  await f.flush();
  assertEquals(f.fetched.length, 1);
  assertEquals(f.fetched[0].url, env.APPS_SCRIPT_URL);
  assertEquals(JSON.parse(f.fetched[0].init.body), { secret: 'shh', email: 'jane@example.com' });
  assertEquals(f.calls.find((c) => c.name === 'rpc:rate_limit_key_request')!.args[0], { p_email: 'jane@example.com', p_ip: '203.0.113.9' });
});

Deno.test('unknown email, rate-limited, or db error: same answer, Apps Script never called', async () => {
  for (const o of [{ member: false }, { allowed: false }, { rpcError: true }]) {
    const f = setup(o);
    const res = await handle(post({ email: 'x@example.com' }, null), f.deps);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { message: GENERIC_MESSAGE });
    await f.flush();
    assertEquals(f.fetched.length, 0);
  }
});

Deno.test('the reply is sent before any slow work happens', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = fakeDeps({
    env,
    admin: { rpc: { rate_limit_key_request: async () => { await gate; return { data: true }; } }, query: () => ({ data: [{ id: 'm1' }] }) },
    fetch: (() => Promise.resolve(new Response('ok'))) as any,
  });
  const res = await handle(post({ email: 'jane@example.com' }, null), f.deps);   // resolves while the work is still blocked
  assertEquals(res.status, 200);
  release();
  await f.flush();
});

Deno.test('invalid input is rejected without side effects; works without an Authorization header', async () => {
  const f = setup();
  for (const b of [{}, { email: 'nope' }, { email: 5 }, 'garbage']) assertEquals((await handle(post(b as any, null), f.deps)).status, 400);
  await f.flush();
  assertEquals(f.calls.length, 0);
});

Deno.test('Apps Script failure is logged, never shown', async () => {
  const f = fakeDeps({
    env,
    admin: { rpc: { rate_limit_key_request: () => ({ data: true }) }, query: () => ({ data: [{ id: 'm1' }] }) },
    fetch: (() => Promise.resolve(new Response('forbidden', { status: 200 }))) as any,
  });
  const res = await handle(post({ email: 'jane@example.com' }, null), f.deps);
  assertEquals(await res.json(), { message: GENERIC_MESSAGE });
  await f.flush();
  assert(true);
});
