// Admin account + member ban management. The database RPCs enforce who may do what (owner vs admin)
// and write the audit log as the calling user; this function adds the Auth-side effects
// (invite, ban, session revocation) that need the service role.
import { authenticate, type Deps } from '../_shared/deps.ts';
import { bearer, dbError, errorResponse, gate, json, readJson } from '../_shared/http.ts';

const BAN_FOREVER = '876000h';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function logAuthFailure(operation: string, action: string, id: string, error: unknown): void {
  const detail = errorDetails(error);
  console.error(`admin-manage: ${operation}`, {
    action,
    target_id: id,
    code: detail.code,
    message: detail.message,
  });
}

function errorDetails(error: unknown): { message: string; code?: string } {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
  return { message, code };
}

async function updateAuthStatus(
  admin: ReturnType<Deps['admin']>,
  id: string,
  active: boolean,
  action: string,
): Promise<Response | null> {
  const failures: string[] = [];
  try {
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: active ? 'none' : BAN_FOREVER,
    });
    if (error) {
      logAuthFailure('Auth ban status update failed', action, id, error);
      failures.push('Auth ban status update');
    }
  } catch (error) {
    logAuthFailure('Auth ban status update threw an exception', action, id, error);
    failures.push('Auth ban status update');
  }

  if (!active) {
    try {
      const { error } = await admin.rpc('revoke_user_sessions', { p_user: id });
      if (error) {
        logAuthFailure('session revocation RPC failed', action, id, error);
        failures.push('session revocation');
      }
    } catch (error) {
      logAuthFailure('session revocation RPC threw an exception', action, id, error);
      failures.push('session revocation');
    }
  }

  if (failures.length) {
    return errorResponse(
      'partial_failure',
      `Database status was changed, but ${failures.join(' and ')} failed. Check server logs and retry the action.`,
      500,
    );
  }
  return null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;

  const token = bearer(req);
  const caller = await authenticate(deps, token);
  if (!caller || !token) return errorResponse('unauthorized', 'Please log in again.', 401);
  const body = await readJson(req);
  const action = body?.action;
  if (typeof action !== 'string') return errorResponse('bad_request', 'action is required.');

  const user = deps.userClient(token, req.headers.get('x-organization-id') ?? undefined);
  const admin = deps.admin();

  // Roles are decided by the database, with the caller's own JWT.
  const ownerActions = ['invite_admin', 'remove_admin', 'restore_admin', 'reset_admin_password'];
  const adminActions = ['ban_member', 'unban_member'];
  if (!ownerActions.includes(action) && !adminActions.includes(action)) {
    return errorResponse('bad_request', 'Unknown action.');
  }
  const { data: allowed, error: roleErr } = await user.rpc(ownerActions.includes(action) ? 'is_owner' : 'is_admin');
  if (roleErr) return dbError(roleErr);
  if (allowed !== true) return errorResponse('forbidden', 'Not allowed.', 403);

  if (action === 'invite_admin') {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body?.role;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorResponse('invalid_email', 'Enter a valid email address.');
    if (role !== 'admin' && role !== 'owner') return errorResponse('bad_request', 'Role must be admin or owner.');

    const { data: asMember } = await admin.from('members').select('id').eq('email', email).maybeSingle();
    if (asMember) return errorResponse('member_email', 'This email is registered as a member and cannot be an admin.', 409);

    // The invite email template links to {SITE_URL}/auth/confirm (see supabase/templates/invite.html).
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (invErr || !invited?.user) {
      const exists = /already|registered|exists/i.test(invErr?.message ?? '');
      return errorResponse(exists ? 'email_exists' : 'invite_failed',
        exists ? 'That email already has an account.' : 'Could not send the invite.', exists ? 409 : 500);
    }
    const { error } = await user.rpc('owner_add_admin', { p_user: invited.user.id, p_email: email, p_role: role });
    if (error) {
      await admin.auth.admin.deleteUser(invited.user.id);   // do not leave a dangling Auth user
      return dbError(error);
    }
    return json({ ok: true });
  }

  const id = body?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return errorResponse('bad_request', 'A valid id is required.');

  if (action === 'remove_admin' || action === 'restore_admin') {
    const restore = action === 'restore_admin';
    const { error } = await user.rpc('owner_set_admin_active', { p_id: id, p_active: restore });
    if (error) return dbError(error);
    const failure = await updateAuthStatus(admin, id, restore, action);
    if (failure) return failure;
    return json({ ok: true });
  }

  if (action === 'reset_admin_password') {
    const { data: target } = await admin.from('admins').select('email').eq('id', id).maybeSingle();
    if (!target) return errorResponse('not_found', 'Admin not found.', 404);
    const { error } = await admin.auth.resetPasswordForEmail(target.email);
    if (error) return errorResponse('reset_failed', 'Could not send the reset email.', 500);
    return json({ ok: true });
  }

  // ban_member / unban_member
  const active = action === 'unban_member';
  const { error } = await user.rpc('set_member_active', { p_member: id, p_active: active });
  if (error) return dbError(error);
  const failure = await updateAuthStatus(admin, id, active, action);
  if (failure) return failure;
  return json({ ok: true });
}
