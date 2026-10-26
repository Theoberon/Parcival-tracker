import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Organizations from './Organizations';

export default async function OrganizationsPage() {
  const { organizationId } = await requireAdmin({ platformOwner: true, allowUnscoped: true });
  return <Page wide><Organizations selectedId={organizationId} /></Page>;
}
