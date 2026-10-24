'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { callRpc } from '@/lib/api';
import CategoryIcon from '@/components/CategoryIcon';
import type { Banner, Category, LeaderRow } from '@/lib/types';

// Full-screen leaderboard for projecting. Refreshes every 30 seconds.
export default function Board() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);

  const load = useCallback(async () => {
    const [l, b] = await Promise.all([
      callRpc<LeaderRow[]>('get_leaderboard'),
      callRpc<Banner[]>('get_contest_banner'),
    ]);
    if (l.ok) setRows(l.data);
    if (b.ok) setBanner(b.data[0] ?? null);

    const { data, error } = await (await import('@/lib/supabase/browser')).supabaseBrowser()
      .from('categories')
      .select('id, name, points, reference_label, reference_hint, active, sort_order')
      .order('sort_order');
    if (!error) setCategories((data as Category[] | null ?? []).filter((cat) => cat.active).sort((a, b) => a.sort_order - b.sort_order));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const label = banner?.status === 'final' || banner?.status === 'archived' ? 'Final results'
    : banner?.status === 'closed' ? `Provisional · ${banner.pending_count} under review` : banner?.status === 'setup' ? 'Starting soon' : 'Live';

  const visibleCategories = categories;
  const gridTemplateColumns = `3rem minmax(12rem, 1fr) repeat(${visibleCategories.length}, 4rem) 5rem`;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white sm:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-bold sm:text-5xl">{banner?.name ?? 'Leaderboard'}</h1>
          <span className="rounded-full bg-white/10 px-4 py-1 text-sm sm:text-lg">{label}</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div className="mb-2 grid items-center gap-4 border-b border-white/10 pb-2 text-sm uppercase tracking-wider text-slate-300" style={{ gridTemplateColumns }}>
              <span className="text-right">#</span>
              <span>Name</span>
              {visibleCategories.map((cat) => (
                <span key={cat.id} className="text-center" title={cat.name} aria-label={cat.name}>
                  <CategoryIcon name={cat.name} />
                  <span className="sr-only">{cat.name}</span>
                </span>
              ))}
              <span className="text-right">Points</span>
            </div>
            <ol className="divide-y divide-white/10">
              {rows.map((r, i) => (
                <li key={i} className={`grid items-center gap-4 py-3 text-xl sm:py-4 sm:text-2xl ${r.rank === 1 ? 'text-amber-300' : r.rank === 2 ? 'text-slate-200' : r.rank === 3 ? 'text-orange-300' : ''} ${r.rank === null ? 'text-slate-500' : ''}`} style={{ gridTemplateColumns }}>
                  <span className="text-right tabular-nums">{r.rank ?? ''}</span>
                  <span className="truncate font-medium">{r.display_name}</span>
                  {visibleCategories.map((cat) => (
                    <span key={cat.id} className="text-center tabular-nums">{r.category_counts?.[cat.id] ?? 0}</span>
                  ))}
                  <span className="text-right font-semibold tabular-nums">{r.points}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-10 flex gap-4 text-sm text-slate-400">
          <Link href="/admin" className="underline">Back to admin</Link>
          <button className="underline" onClick={() => document.documentElement.requestFullscreen?.()}>Full screen</button>
        </div>
      </div>
    </main>
  );
}
