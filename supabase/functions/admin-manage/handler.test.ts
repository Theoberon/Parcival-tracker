// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { handle } from './handler.ts';

const caller = { id: 'caller-1', email: 'o@x.test' };
const ID = '22222222-2222-4222-8222-222222222222';

function setup(role: 'owner' | 'admin' | 'none', extra: {
  rpc?: Record<string, any>;
  memberExists?: boolean;
  adminRow?: any;
  authUpdateError?: string;
  revokeError?: string;
  authUpdateThrow?: boolean;
  revokeThrow?: boolean;
} = {}) {
  return fakeDeps({
    env: { SITE_URL: 'https://contest.example.com/' },
    user: {
      user: caller,
      rpc: {
        is_owner: () => ({ data: role === 'owner' }),
        is_admin: () => ({ data: role === 'owner' || role === 'admin' }),
        owner_add_admin: () => ({ data: null }),
        owner_set_admin_active: () => ({ data: null }),
        set_member_active: () => ({ data: null }),
        ...extra.rpc,
      },
    },
    admin: {
      user: caller,
      query: (q) => (q.table === 'members' ? { data: extra.memberExists ? [{ id: 'm' }] : [] } : { data: extra.adminRow ? [extra.adminRow] : [] }),
      rpc: {
        revoke_user_sessions: () => {
          if (extra.revokeThrow) throw new Error('session revocation connection failed');
          return extra.revokeError ? { error: { message: extra.revokeError, code: 'XX000' } } : { data: null };
        },
      },
      authAdmin: {
        updateUserById: () => {
          if (extra.authUpdateThrow) throw new Error('Auth API connection failed');
          return extra.authUpdateError ? { error: { message: extra.authUpdateError, code: 'XX000' } } : { data: null };
        },
      },
    },
  });
}

Deno.test('invite: owner only. Non-owners are refused before anything happens', async () => {
  for (const role of ['admin', 'none'] as const) {
    const f = setup(role);
    const res = await handle(post({ action: 'invite_admin', email: 'n@x.test', role: 'admin' }), f.deps);
    assertEquals(res.status, 403, role);
    assert(!f.calls.some((c) => c.name.startsWith('auth.admin')));
  }
});

Deno.test('invite: creates the Auth invite, then registers the admin as the owner', async () => {
  const f = setup('owner');
  const res = await handle(post({ action: 'invite_admin', email: ' New@X.test ', role: 'admin' }), f.deps);
  assertEquals(res.status, 200);
  const inv = f.calls.find((c) => c.name === 'auth.admin.inviteUserByEmail')!;
  assertEquals(inv.args[0], 'new@x.test');
  const add = f.userCalls.find((c) => c.name === 'rpc:owner_add_admin')!;   // via the OWNER's JWT so the audit log shows who did it
  assertEquals(add.args[0], { p_user: '11111111-1111-4111-8111-111111111111', p_email: 'new@x.test', p_role: 'admin' });
});

Deno.test('invite: a member email is refused; a failed registration removes the Auth user', async () => {
  const f = setup('owner', { memberExists: true });
  assertEquals((await handle(post({ action: 'invite_admin', email: 'm@x.test', role: 'admin' }), f.deps)).status, 409);
  assert(!f.calls.some((c) => c.name === 'auth.admin.inviteUserByEmail'));

  const g = setup('owner', { rpc: { owner_add_admin: () => ({ error: { message: 'member_email: nope' } }) } });
  const res = await handle(post({ action: 'invite_admin', email: 'm@x.test', role: 'admin' }), g.deps);
  assertEquals(res.status, 400);
  assert(g.calls.some((c) => c.name === 'auth.admin.deleteUser'));
});

Deno.test('invite: validates input', async () => {
  const f = setup('owner');
  assertEquals((await handle(post({ action: 'invite_admin', email: 'bad', role: 'admin' }), f.deps)).status, 400);
  assertEquals((await handle(post({ action: 'invite_admin', email: 'a@x.test', role: 'root' }), f.deps)).status, 400);
  assertEquals((await handle(post({ action: 'nope' }), f.deps)).status, 400);
  assertEquals((await handle(post({ action: 'remove_admin', id: 'not-a-uuid' }), f.deps)).status, 400);
});

Deno.test('remove admin: database check first, then ban + revoke sessions', async () => {
  const f = setup('owner');
  assertEquals((await handle(post({ action: 'remove_admin', id: ID }), f.deps)).status, 200);
  assertEquals(f.userCalls.find((c) => c.name === 'rpc:owner_set_admin_active')!.args[0], { p_id: ID, p_active: false });
  assertEquals(f.calls.find((c) => c.name === 'auth.admin.updateUserById')!.args, [ID, { ban_duration: '876000h' }]);
  assertEquals(f.calls.find((c) => c.name === 'rpc:revoke_user_sessions')!.args[0], { p_user: ID });

  // database refuses (e.g. removing yourself): no ban happens
  const g = setup('owner', { rpc: { owner_set_admin_active: () => ({ error: { message: 'self_remove: You cannot remove yourself.' } }) } });
  assertEquals((await handle(post({ action: 'remove_admin', id: ID }), g.deps)).status, 400);
  assert(!g.calls.some((c) => c.name === 'auth.admin.updateUserById'));
});

Deno.test('restore admin unbans', async () => {
  const f = setup('owner');
  await handle(post({ action: 'restore_admin', id: ID }), f.deps);
  assertEquals(f.calls.find((c) => c.name === 'auth.admin.updateUserById')!.args, [ID, { ban_duration: 'none' }]);
});

Deno.test('reset password: owner only, looks up the admin email, never exposes it', async () => {
  const f = setup('owner', { adminRow: { email: 'a@x.test' } });
  const res = await handle(post({ action: 'reset_admin_password', id: ID }), f.deps);
  assertEquals(await res.json(), { ok: true });
  assertEquals(f.calls.find((c) => c.name === 'auth.resetPasswordForEmail')!.args[0], 'a@x.test');
  const g = setup('admin', { adminRow: { email: 'a@x.test' } });
  assertEquals((await handle(post({ action: 'reset_admin_password', id: ID }), g.deps)).status, 403);
});

Deno.test('ban / unban member: any admin; members cannot', async () => {
  const f = setup('admin');
  assertEquals((await handle(post({ action: 'ban_member', id: ID }), f.deps)).status, 200);
  assertEquals(f.userCalls.find((c) => c.name === 'rpc:set_member_active')!.args[0], { p_member: ID, p_active: false });
  assertEquals(f.calls.find((c) => c.name === 'auth.admin.updateUserById')!.args, [ID, { ban_duration: '876000h' }]);
  assert(f.calls.some((c) => c.name === 'rpc:revoke_user_sessions'));

  const u = setup('admin');
  await handle(post({ action: 'unban_member', id: ID }), u.deps);
  assertEquals(u.calls.find((c) => c.name === 'auth.admin.updateUserById')!.args, [ID, { ban_duration: 'none' }]);

  const m = setup('none');
  assertEquals((await handle(post({ action: 'ban_member', id: ID }), m.deps)).status, 403);
  assert(!m.calls.some((c) => c.name.startsWith('auth.admin')));
});

Deno.test('ban reports and logs Auth and session-revocation failures after the database change', async () => {
  const f = setup('admin', {
    authUpdateError: 'Auth API unavailable',
    revokeError: 'session revocation unavailable',
  });
  const res = await handle(post({ action: 'ban_member', id: ID }), f.deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), {
    error: 'partial_failure',
    message: 'Database status was changed, but Auth ban status update and session revocation failed. Check server logs and retry the action.',
  });
  assert(f.userCalls.some((c) => c.name === 'rpc:set_member_active'));
  assert(f.calls.some((c) => c.name === 'auth.admin.updateUserById'));
  assert(f.calls.some((c) => c.name === 'rpc:revoke_user_sessions'));
});

Deno.test('Auth ban exceptions are reported and session revocation is still attempted', async () => {
  const f = setup('owner', { authUpdateThrow: true, revokeThrow: true });
  const res = await handle(post({ action: 'remove_admin', id: ID }), f.deps);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'partial_failure');
  assert(f.calls.some((c) => c.name === 'rpc:revoke_user_sessions'));
});

Deno.test('unauthenticated -> 401', async () => {
  const f = fakeDeps();
  assertEquals((await handle(post({ action: 'ban_member', id: ID }, null), f.deps)).status, 401);
  assertEquals((await handle(post({ action: 'ban_member', id: ID }, 'bad'), f.deps)).status, 401);
});
