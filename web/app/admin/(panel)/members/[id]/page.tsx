import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import MemberDetail from './MemberDetail';

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <Page wide><MemberDetail id={id} /></Page>;
}
