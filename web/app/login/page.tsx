import { redirect } from 'next/navigation';
import { getAdminRow } from '@/lib/auth';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const { user, admin } = await getAdminRow();
  if (user) redirect(admin ? '/admin' : '/dashboard');
  return <LoginForm />;
}
