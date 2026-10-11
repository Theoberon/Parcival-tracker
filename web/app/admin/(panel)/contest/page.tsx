import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import ContestAdmin from './ContestAdmin';

export default async function ContestPage() {
  await requireAdmin({ owner: true });   // owners only; the database enforces it as well
  return <Page wide><ContestAdmin /></Page>;
}
