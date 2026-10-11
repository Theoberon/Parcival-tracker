'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge } from '@/components/ui';
import { callRpc } from '@/lib/api';
import type { AdminLeaderRow } from '@/lib/types';

export default function Members() {
  const [rows, setRows] = useState<AdminLeaderRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    callRpc<AdminLeaderRow[]>('get_admin_leaderboard').then((r) => (r.ok ? setRows(r.data) : setError(r.message)));
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Members</h1>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {rows === null && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <div className="glass-panel overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Points</th><th className="px-3 py-2 text-right">Tasks</th><th className="px-3 py-2 text-right">Pending</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows?.map((m) => (
              <tr key={m.member_id} className={m.active ? '' : 'bg-slate-50 text-slate-400'}>
                <td className="px-3 py-2 tabular-nums">{m.rank ?? '–'}</td>
                <td className="px-3 py-2 font-medium">
                  <Link className="underline" href={`/admin/members/${m.member_id}`}>{m.display_name}</Link>{' '}
                  {!m.active ? <Badge>inactive</Badge> : null}
                </td>
                <td className="px-3 py-2">{m.title}</td>
                <td className="px-3 py-2">{m.email}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.points}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.tasks_completed}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.pending_count ? <Badge kind="pending">{m.pending_count}</Badge> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
