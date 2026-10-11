import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Review from './Review';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <Page wide><Review id={id} /></Page>;
}
