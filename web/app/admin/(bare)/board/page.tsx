import { requireAdmin } from '@/lib/auth';
import Board from './Board';

export default async function BoardPage() {
  await requireAdmin();
  return <Board />;
}
