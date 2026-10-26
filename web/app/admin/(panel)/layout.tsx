import AdminNav from '@/components/admin/AdminNav';
import IdleLogout from '@/components/admin/IdleLogout';
import { Alert } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { admin, platformOwner, organizationId, platformOwnerSetupPending } = await requireAdmin({ allowUnscoped: true });
  return (
    <>
      <AdminNav role={admin.role} email={admin.email} platformOwner={platformOwner} organizationId={organizationId} />
      {platformOwnerSetupPending ? (
        <div className="mx-auto w-full max-w-5xl px-4 pt-4">
          <Alert tone="warn">
            Organisation management is not enabled yet. Apply the platform-owner database migration in Supabase. If it has already been applied, refresh the schema cache with <code>NOTIFY pgrst, &apos;reload schema&apos;;</code>.
          </Alert>
        </div>
      ) : null}
      <IdleLogout />
      {children}
    </>
  );
}
