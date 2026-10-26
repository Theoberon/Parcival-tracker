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
    admin: { query: (q) => (q.table === 'submissions' && q.action === 'select'
      ? { data: [{ id: 'a', proof_path: 'p/a' }, { id: 'b', proof_path: 'p/b' }] }
      : { data: [] }) },
  });
  const res = await handle(post({}, 'service-role-key'), f.deps);
  assertEquals(await res.json(), { deleted: 2, expired_contests_deleted: 0, screenshots_deleted: 0 });
  const select = f.calls.find((c) => c.name === 'from:submissions:select')!;
  assertEquals(select.args[0], [['status', 'eq', 'draft'], ['created_at', 'lt', '2026-10-20T11:00:00.000Z']]);
  assertEquals(f.calls.find((c) => c.name === 'storage.remove')!.args[0], ['p/a', 'p/b']);
  assertEquals(f.calls.find((c) => c.name === 'from:submissions:delete')!.args[0], [['id', 'in', ['a', 'b']]]);
});

Deno.test('nothing to do', async () => {
  const f = fakeDeps({ env, admin: { query: () => ({ data: [] }) } });
  assertEquals(await (await handle(post({}, 'service-role-key'), f.deps)).json(), {
    deleted: 0, expired_contests_deleted: 0, screenshots_deleted: 0,
  });
});

Deno.test('expired contest screenshots are removed before history is purged', async () => {
  let removed = false;
  const f = fakeDeps({
    env,
    admin: {
      query: (q) => q.table === 'contest_history'
        ? { data: [{ source_contest_id: 'old-contest' }] }
        : { data: [] },
      storage: {
        list: (prefix: string) => removed ? { data: [] } : prefix === 'old-contest'
          ? { data: [{ name: 'member' }] }
          : prefix === 'old-contest/member' ? { data: [{ name: 'proof.png' }] } : { data: [] },
        remove: (paths: string[]) => {
          removed = true;
          return { data: paths.map((path) => ({ name: path.split('/').pop()! })) };
        },
      },
    },
  });
  const response = await handle(post({}, 'service-role-key'), f.deps);
  assertEquals(await response.json(), { deleted: 0, expired_contests_deleted: 1, screenshots_deleted: 1 });
  assertEquals(f.calls.find((c) => c.name === 'storage.remove')!.args[0], ['old-contest/member/proof.png']);
  const purge = f.calls.find((c) => c.name === 'rpc:purge_expired_contest_history')!;
  assertEquals(purge.args[0], { p_source_contest_ids: ['old-contest'] });
  const history = f.calls.find((c) => c.name === 'from:contest_history:select')!;
  assertEquals(history.args[0], [['expires_at', 'lte', '2026-10-20T12:00:00.000Z']]);
});

Deno.test('failed screenshot cleanup retains history and skips the purge RPC', async () => {
  const f = fakeDeps({
    env,
    admin: {
      query: (q) => q.table === 'contest_history' ? { data: [{ source_contest_id: 'old-contest' }] } : { data: [] },
      storage: {
        list: (prefix: string) => prefix === 'old-contest' ? { data: [{ name: 'member' }] } : { data: [{ name: 'proof.png' }] },
        remove: () => ({ data: null, error: { message: 'storage unavailable' } }),
      },
    },
  });
  const response = await handle(post({}, 'service-role-key'), f.deps);
  assertEquals(response.status, 500);
  assertEquals(f.calls.some((c) => c.name === 'rpc:purge_expired_contest_history'), false);
});
