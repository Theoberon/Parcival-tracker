import AdminNav from '@/components/admin/AdminNav';
import IdleLogout from '@/components/admin/IdleLogout';
import { requireAdmin } from '@/lib/auth';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await requireAdmin();
  return (
    <>
      <AdminNav role={admin.role} email={admin.email} />
      <IdleLogout />
      {children}
    </>
  );
}
