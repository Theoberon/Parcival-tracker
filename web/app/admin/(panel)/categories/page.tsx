import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import Categories from './Categories';

export default async function CategoriesPage() {
  await requireAdmin();
  return <Page wide><Categories /></Page>;
}
