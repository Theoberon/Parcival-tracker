// Server-side guards. Every protected page calls one of these; they are the real access check
// (the proxy only redirects logged-out visitors).
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isUuid, ORGANIZATION_SCOPE_COOKIE } from './organization-scope';
import { supabaseServer } from './supabase/server';

const ADMIN_MAX_SESSION_MS = 12 * 60 * 60 * 1000;
type AdminRow = { id: string; email: string; role: 'owner' | 'admin'; active: boolean; organization_id: string };

export async function getUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function getAdminRow() {
  const { supabase, user } = await getUser();
  if (!user) return {
    supabase, user: null, admin: null, platformOwner: false, organizationId: null,
    platformOwnerSetupPending: false,
  };
  const [{ data, error }, platformResult, cookieStore] = await Promise.all([
    supabase.from('admins').select('id, email, role, active, organization_id').eq('id', user.id).maybeSingle(),
    supabase.rpc('is_platform_admin'),
    cookies(),
  ]);
  if (error) throw new Error(`Could not load admin access: ${error.message}`);
  const platformOwnerFunctionMissing = platformResult.error?.code === 'PGRST202'
    && /is_platform_admin/.test(platformResult.error.message);
  if (platformResult.error && !platformOwnerFunctionMissing) {
    throw new Error(`Could not verify platform-owner access: ${platformResult.error.message}`);
  }
  if (platformOwnerFunctionMissing) {
    console.warn('Platform-owner access check is unavailable. Apply the platform-owner organisation management migration and refresh the Supabase schema cache.');
  }
  const platformOwner = !platformOwnerFunctionMissing && platformResult.data === true;
  const admin = platformOwner
    ? { id: user.id, email: user.email ?? '', role: 'owner' as const, active: true }
    : data?.active ? (data as AdminRow) : null;
  let organizationId: string | null = !platformOwner && data?.active ? data.organization_id : null;
  const selectedId = cookieStore.get(ORGANIZATION_SCOPE_COOKIE)?.value;
  if (platformOwner && isUuid(selectedId)) {
    const { data: selected, error: organizationError } = await supabase
      .from('organizations').select('id').eq('id', selectedId).maybeSingle();
    if (organizationError) throw new Error(`Could not verify selected organisation: ${organizationError.message}`);
    organizationId = selected?.id ?? null;
  }
  return {
    supabase, user, admin, platformOwner, organizationId,
    platformOwnerSetupPending: platformOwnerFunctionMissing,
  };
}

export async function requireAdmin(opts: { owner?: boolean; platformOwner?: boolean; allowUnscoped?: boolean } = {}) {
  const { supabase, user, admin, platformOwner, organizationId, platformOwnerSetupPending } = await getAdminRow();
  if (!user) redirect('/admin/login');
  if (!admin) redirect('/admin/login?error=not_admin');
  if (opts.platformOwner && !platformOwner) redirect('/admin');
  // Absolute cap on top of the client idle timer: 12 hours since the last password sign-in.
  if (user.last_sign_in_at && Date.now() - new Date(user.last_sign_in_at).getTime() > ADMIN_MAX_SESSION_MS) {
    redirect('/admin/logout?expired=1');
  }
  if (platformOwner && !organizationId && !opts.allowUnscoped) redirect('/admin/organizations');
  if (opts.owner && admin.role !== 'owner') redirect('/admin');
  return { supabase, user, admin, platformOwner, organizationId, platformOwnerSetupPending };
}

export async function requireMember() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/login');
  const { data: admin } = await supabase.from('admins').select('id').eq('id', user.id).maybeSingle();
  if (admin) return { supabase, user, state: 'admin' as const, member: null };
  const { data: member } = await supabase.from('members').select('id, display_name, title, active').eq('id', user.id).maybeSingle();
  if (!member) return { supabase, user, state: 'none' as const, member: null };
  return { supabase, user, state: member.active ? ('member' as const) : ('inactive' as const), member };
}
