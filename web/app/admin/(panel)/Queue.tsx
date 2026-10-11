'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { waiting } from '@/lib/format';
import type { AdminSubmission } from '@/lib/types';

export default function Queue({ meId }: { meId: string }) {
  const [rows, setRows] = useState<AdminSubmission[] | null>(null);
  const [admins, setAdmins] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.from('submissions')
      .select('id, reference, submitted_at, attempt, flags, claimed_by, claimed_until, member:members(display_name, title), category:categories(name, points)')
      .eq('status', 'pending').order('submitted_at', { ascending: true });
    if (error) return setError('Could not load the queue.');
    setError('');
    setRows(data as unknown as AdminSubmission[]);
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    load();
    supabase.from('admins').select('id, email').then(({ data }) =>
      setAdmins(Object.fromEntries((data ?? []).map((a: { id: string; email: string }) => [a.id, a.email]))));
    const poll = setInterval(() => { load(); tick((n) => n + 1); }, 15_000);
    const ch = supabase.channel('admin-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => load()).subscribe();
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Review queue</h1>
        <span className="text-sm text-slate-500">{rows ? `${rows.length} pending, oldest first` : ''}</span>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {rows?.length === 0 ? <Card><p className="text-sm text-slate-600">All caught up.</p></Card> : null}
      <ul className="space-y-2">
        {rows?.map((r) => {
          const held = r.claimed_until && new Date(r.claimed_until) > new Date() && r.claimed_by;
          return (
            <li key={r.id}>
              <Link href={`/admin/review/${r.id}`} className="glass-panel block rounded-2xl border p-3 transition hover:border-sky-300/30 hover:bg-white/5 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.member?.display_name}</span>
                  {r.member?.title ? <span className="text-sm text-slate-500">{r.member.title}</span> : null}
                  <span className="text-sm text-slate-600">{r.category?.name} · {r.category?.points} pt</span>
                  {r.attempt > 1 ? <Badge kind="flag">Resubmission (attempt {r.attempt})</Badge> : null}
                  {r.flags?.includes('reused_proof') ? <Badge kind="flag">Screenshot reused</Badge> : null}
                  {held ? <Badge kind="pending">{r.claimed_by === meId ? 'Held by you' : `Held by ${admins[r.claimed_by!] ?? 'another admin'}`}</Badge> : null}
                  <span className="ml-auto text-xs text-slate-500">waiting {waiting(r.submitted_at)}</span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-700">{r.reference}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
