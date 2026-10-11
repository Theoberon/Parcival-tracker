'use client';
import { useRouter } from 'next/navigation';
import { Button } from './ui';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function LogoutButton({ to = '/login' }: { to?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace(to);
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}
