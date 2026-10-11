'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { callRpc } from '@/lib/api';
import type { Banner, LeaderRow } from '@/lib/types';

// Full-screen leaderboard for projecting. Refreshes every 30 seconds.
export default function Board() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);

  const load = useCallback(async () => {
    const [l, b] = await Promise.all([callRpc<LeaderRow[]>('get_leaderboard'), callRpc<Banner[]>('get_contest_banner')]);
    if (l.ok) setRows(l.data);
    if (b.ok) setBanner(b.data[0] ?? null);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const label = banner?.status === 'final' || banner?.status === 'archived' ? 'Final results'
    : banner?.status === 'closed' ? `Provisional · ${banner.pending_count} under review` : banner?.status === 'setup' ? 'Starting soon' : 'Live';

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white sm:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-bold sm:text-5xl">{banner?.name ?? 'Leaderboard'}</h1>
          <span className="rounded-full bg-white/10 px-4 py-1 text-sm sm:text-lg">{label}</span>
        </div>
        <ol className="divide-y divide-white/10">
          {rows.map((r, i) => (
            <li key={i} className={`flex items-center gap-4 py-3 text-xl sm:py-4 sm:text-3xl ${r.rank === 1 ? 'text-amber-300' : r.rank === 2 ? 'text-slate-200' : r.rank === 3 ? 'text-orange-300' : ''} ${r.rank === null ? 'text-slate-500' : ''}`}>
              <span className="w-12 text-right tabular-nums sm:w-20">{r.rank ?? ''}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.display_name}</span>
              <span className="w-24 text-right font-semibold tabular-nums sm:w-36">{r.points}</span>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex gap-4 text-sm text-slate-400">
          <Link href="/admin" className="underline">Back to admin</Link>
          <button className="underline" onClick={() => document.documentElement.requestFullscreen?.()}>Full screen</button>
        </div>
      </div>
    </main>
  );
}
