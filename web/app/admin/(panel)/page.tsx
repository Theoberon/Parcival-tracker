import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Queue from './Queue';

export default async function QueuePage() {
  const { user } = await requireAdmin();
  return <Page wide><Queue meId={user.id} /></Page>;
}
