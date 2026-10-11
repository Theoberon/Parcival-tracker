import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { Card, Page } from '@/components/ui';
import LogoutButton from '@/components/LogoutButton';
import Dashboard from './Dashboard';

export default async function DashboardPage() {
  const { user, state, member } = await requireMember();

  if (state === 'member' && member) return <Dashboard userId={user.id} displayName={member.display_name} title={member.title} />;

  return (
    <Page>
      <Card>
        {state === 'admin' ? (
          <>
            <p className="mb-3 text-sm">Admin accounts do not take part in the contest.</p>
            <Link className="font-medium underline" href="/admin">Go to the admin area</Link>
          </>
        ) : state === 'inactive' ? (
          <p className="text-sm">Your account has been deactivated. Please contact the contest organizers.</p>
        ) : (
          <p className="text-sm">This login is not registered for the contest.</p>
        )}
        <div className="mt-4"><LogoutButton /></div>
      </Card>
    </Page>
  );
}
