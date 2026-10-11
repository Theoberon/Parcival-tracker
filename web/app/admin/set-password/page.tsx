import { redirect } from 'next/navigation';
import { getAdminRow } from '@/lib/auth';
import SetPasswordForm from './SetPasswordForm';

export default async function SetPasswordPage() {
  const { admin } = await getAdminRow();
  if (!admin) redirect('/admin/login?error=invalid_link');
  return <SetPasswordForm />;
}
