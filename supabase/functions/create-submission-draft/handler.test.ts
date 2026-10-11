// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { handle } from './handler.ts';

const body = { category_id: 'cat', reference: 'jane_designs', note: 'hi', file_ext: 'webp' };

Deno.test('success: calls the RPC as the user, returns a signed upload token', async () => {
  const f = fakeDeps({
    user: { rpc: { create_submission_draft: () => ({ data: [{ submission_id: 's1', proof_path: 'c/m/s1.webp' }] }) } },
  });
  const res = await handle(post(body), f.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { submission_id: 's1', path: 'c/m/s1.webp', token: 'tok' });
  assertEquals(f.userCalls[0], { name: 'userClient', args: ['user-jwt'] });
  assertEquals(f.userCalls[1].args[0], { p_category_id: 'cat', p_reference: 'jane_designs', p_note: 'hi', p_file_ext: 'webp', p_resubmission_of: null });
  assertEquals(f.calls.find((c) => c.name === 'storage.createSignedUploadUrl')!.args, ['proofs', 'c/m/s1.webp']);
});

Deno.test('rule violations are passed through with a status the UI can use', async () => {
  for (const [code, status] of [['duplicate_reference', 409], ['rate_limited', 429], ['not_member', 403], ['resubmission_limit', 400], ['submissions_closed', 400]] as const) {
    const f = fakeDeps({ user: { rpc: { create_submission_draft: () => ({ error: { message: `${code}: Some friendly text.` } }) } } });
    const res = await handle(post(body), f.deps);
    assertEquals(res.status, status, code);
    assertEquals(await res.json(), { error: code, message: 'Some friendly text.' });
  }
});

Deno.test('no token or invalid JWT -> 401', async () => {
  const f = fakeDeps();
  assertEquals((await handle(post(body, null), f.deps)).status, 401);
  const g = fakeDeps({ user: { rpc: { create_submission_draft: () => ({ error: { message: 'JWT expired', code: 'PGRST301' } }) } } });
  assertEquals((await handle(post(body), g.deps)).status, 401);
});

Deno.test('unexpected database errors are not leaked', async () => {
  const f = fakeDeps({ user: { rpc: { create_submission_draft: () => ({ error: { message: 'relation "secret_table" does not exist', code: '42P01' } }) } } });
  const res = await handle(post(body), f.deps);
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await res.json()).includes('secret_table'));
});

Deno.test('bad input, wrong method, preflight', async () => {
  const f = fakeDeps();
  assertEquals((await handle(post('nope'), f.deps)).status, 400);
  assertEquals((await handle(post({ reference: 'x' }), f.deps)).status, 400);
  assertEquals((await handle(post({ ...body, note: 5 }), f.deps)).status, 400);
  assertEquals((await handle(new Request('https://x.test', { method: 'GET' }), f.deps)).status, 405);
  const pre = await handle(new Request('https://x.test', { method: 'OPTIONS' }), f.deps);
  assertEquals(pre.status, 200);
  assert(pre.headers.get('Access-Control-Allow-Headers')!.includes('authorization'));
});

Deno.test('upload URL failure -> 500 without details', async () => {
  const f = fakeDeps({
    user: { rpc: { create_submission_draft: () => ({ data: [{ submission_id: 's1', proof_path: 'p' }] }) } },
    admin: { storage: { createSignedUploadUrl: () => ({ data: null, error: { message: 'bucket exploded' } }) } },
  });
  const res = await handle(post(body), f.deps);
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await res.json()).includes('exploded'));
});
