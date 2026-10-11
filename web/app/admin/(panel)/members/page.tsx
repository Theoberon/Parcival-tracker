import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Members from './Members';

export default async function MembersPage() {
  await requireAdmin();
  return <Page wide><Members /></Page>;
}
