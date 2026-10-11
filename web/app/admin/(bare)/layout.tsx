import IdleLogout from '@/components/admin/IdleLogout';
import { requireAdmin } from '@/lib/auth';

export default async function BareLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (<><IdleLogout />{children}</>);
}
