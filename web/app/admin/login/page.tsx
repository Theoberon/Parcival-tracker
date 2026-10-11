import { redirect } from 'next/navigation';
import { getAdminRow } from '@/lib/auth';
import AdminLoginForm from './AdminLoginForm';

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, admin } = await getAdminRow();
  const sp = await searchParams;
  const hasProblem = Boolean(sp.error || sp.expired);
  if (user && admin && !hasProblem) redirect('/admin');
  const notice = sp.expired ? 'You were signed out. Please log in again.'
    : sp.error === 'invalid_link' ? 'That link is invalid or has expired. Ask the owner to send a new one.'
    : sp.error === 'not_admin' ? 'This account is not an admin account.' : '';
  return <AdminLoginForm notice={notice} />;
}
