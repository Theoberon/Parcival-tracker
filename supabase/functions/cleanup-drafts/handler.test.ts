import { assertEquals } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { handle } from './handler.ts';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

Deno.test('only the service role key may call it', async () => {
  const f = fakeDeps({ env });
  assertEquals((await handle(post({}, null), f.deps)).status, 403);
  assertEquals((await handle(post({}, 'user-jwt'), f.deps)).status, 403);
  assertEquals((await handle(post({}, 'service-role-key-x'), f.deps)).status, 403);
  assertEquals(f.calls.length, 0);
});

Deno.test('deletes drafts older than 60 minutes together with their files', async () => {
  const f = fakeDeps({
    env,
    admin: { query: (q) => (q.action === 'select' ? { data: [{ id: 'a', proof_path: 'p/a' }, { id: 'b', proof_path: 'p/b' }] } : { data: null }) },
  });
  const res = await handle(post({}, 'service-role-key'), f.deps);
  assertEquals(await res.json(), { deleted: 2 });
  const select = f.calls.find((c) => c.name === 'from:submissions:select')!;
  assertEquals(select.args[0], [['status', 'eq', 'draft'], ['created_at', 'lt', '2026-10-20T11:00:00.000Z']]);
  assertEquals(f.calls.find((c) => c.name === 'storage.remove')!.args[0], ['p/a', 'p/b']);
  assertEquals(f.calls.find((c) => c.name === 'from:submissions:delete')!.args[0], [['id', 'in', ['a', 'b']]]);
});

Deno.test('nothing to do', async () => {
  const f = fakeDeps({ env, admin: { query: () => ({ data: [] }) } });
  assertEquals(await (await handle(post({}, 'service-role-key'), f.deps)).json(), { deleted: 0 });
});
