'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, H2 } from '@/components/ui';
import CategoryIcon from '@/components/CategoryIcon';
import type { Category, LeaderRow } from '@/lib/types';

function Row({ r, categories, pinned }: { r: LeaderRow; categories: Category[]; pinned?: boolean }) {
  const countFor = (categoryId: string) => r.category_counts?.[categoryId] ?? 0;

  return (
    <div
      className={`grid items-center gap-3 px-3 py-2 text-sm ${r.is_me ? 'bg-amber-300/8 font-semibold ring-1 ring-inset ring-amber-200/25' : ''} ${pinned ? 'shadow-md' : ''}`}
      style={{ gridTemplateColumns: `2rem minmax(8rem, 1fr) repeat(${categories.length}, 3rem) 3.5rem 3rem` }}
    >
      <span className="text-right tabular-nums text-slate-500">{r.rank ?? '–'}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{r.display_name}</span>
        {r.is_me ? <span className="shrink-0 rounded-md border border-amber-200/20 bg-amber-200/10 px-1.5 py-0.5 text-xs font-medium text-amber-100">you</span> : null}
      </span>
      {categories.map((cat) => (
        <span key={cat.id} className="text-center tabular-nums text-slate-700">
          {countFor(cat.id)}
        </span>
      ))}
      <span className="text-right tabular-nums">{r.points}</span>
      <span className="text-right tabular-nums text-slate-500">{r.tasks_completed}</span>
    </div>
  );
}

export default function Leaderboard({ rows, categories }: { rows: LeaderRow[] | null; categories: Category[] }) {
  const myRef = useRef<HTMLDivElement>(null);
  const [myVisible, setMyVisible] = useState(true);
  const me = rows?.find((r) => r.is_me);
  const columnCategories = [...categories].filter((cat) => cat.active).sort((a, b) => a.sort_order - b.sort_order);
  const gridTemplateColumns = `2rem minmax(8rem, 1fr) repeat(${columnCategories.length}, 3rem) 3.5rem 3rem`;

  // When my own row scrolls out of view, pin a copy of it at the top.
  useEffect(() => {
    const el = myRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setMyVisible(entry.isIntersecting), { threshold: 0.9 });
    io.observe(el);
    return () => io.disconnect();
  }, [rows]);

  return (
    <Card className="p-0 sm:p-0">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5"><H2>Leaderboard</H2></div>
      <div className="overflow-x-auto">
        <div className="min-w-max">
        <div className="grid items-center gap-3 border-b border-slate-200 px-3 pb-1 text-xs uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns }}>
          <span className="text-right">#</span>
          <span>Name</span>
            {columnCategories.map((cat) => (
            <span key={cat.id} className="text-center" title={cat.name} aria-label={cat.name}>
                <CategoryIcon name={cat.name} />
                <span className="sr-only">{cat.name}</span>
              </span>
            ))}
          <span className="text-right">Points</span>
          <span className="text-right">Tasks</span>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {me && !myVisible ? <div className="glass-panel sticky top-14 z-10 rounded-lg"><Row r={me} categories={columnCategories} pinned /></div> : null}
            {rows === null ? <p className="p-4 text-sm text-slate-500">Loading…</p> : null}
            {rows?.length === 0 ? <p className="p-4 text-sm text-slate-500">No members yet.</p> : null}
            <ul className="divide-y divide-slate-100">
              {rows?.map((r, i) => (
                <li key={i}>
                  {r.is_me ? <div ref={myRef}><Row r={r} categories={columnCategories} /></div> : <Row r={r} categories={columnCategories} />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
