import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Admins from './Admins';

export default async function AdminsPage() {
  const { user } = await requireAdmin({ owner: true });
  return <Page wide><Admins meId={user.id} /></Page>;
}
