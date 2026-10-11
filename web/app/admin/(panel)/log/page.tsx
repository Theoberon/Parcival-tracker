import { Page } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import AuditLog from './AuditLog';

export default async function LogPage() {
  await requireAdmin();
  return <Page wide><AuditLog /></Page>;
}
