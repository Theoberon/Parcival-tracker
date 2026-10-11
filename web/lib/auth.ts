// Server-side guards. Every protected page calls one of these; they are the real access check
// (the proxy only redirects logged-out visitors).
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';

const ADMIN_MAX_SESSION_MS = 12 * 60 * 60 * 1000;

export async function getUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function getAdminRow() {
  const { supabase, user } = await getUser();
  if (!user) return { supabase, user: null, admin: null };
  const { data } = await supabase.from('admins').select('id, email, role, active').eq('id', user.id).maybeSingle();
  return { supabase, user, admin: data && data.active ? (data as { id: string; email: string; role: 'owner' | 'admin' }) : null };
}

export async function requireAdmin(opts: { owner?: boolean } = {}) {
  const { supabase, user, admin } = await getAdminRow();
  if (!user) redirect('/admin/login');
  if (!admin) redirect('/admin/login?error=not_admin');
  // Absolute cap on top of the client idle timer: 12 hours since the last password sign-in.
  if (user.last_sign_in_at && Date.now() - new Date(user.last_sign_in_at).getTime() > ADMIN_MAX_SESSION_MS) {
    redirect('/admin/logout?expired=1');
  }
  if (opts.owner && admin.role !== 'owner') redirect('/admin');
  return { supabase, user, admin };
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
