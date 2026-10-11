'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, H2 } from '@/components/ui';
import type { LeaderRow } from '@/lib/types';

function Row({ r, pinned }: { r: LeaderRow; pinned?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 text-sm ${r.is_me ? 'bg-amber-300/8 font-semibold ring-1 ring-inset ring-amber-200/25' : ''} ${pinned ? 'shadow-md' : ''}`}
    >
      <span className="w-8 shrink-0 text-right tabular-nums text-slate-500">{r.rank ?? '–'}</span>
      <span className="min-w-0 flex-1 truncate">{r.display_name}</span>
      {r.is_me ? <span className="shrink-0 rounded-md border border-amber-200/20 bg-amber-200/10 px-1.5 py-0.5 text-xs font-medium text-amber-100">you</span> : null}
      <span className="w-14 shrink-0 text-right tabular-nums">{r.points}</span>
      <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{r.tasks_completed}</span>
    </div>
  );
}

export default function Leaderboard({ rows }: { rows: LeaderRow[] | null }) {
  const myRef = useRef<HTMLDivElement>(null);
  const [myVisible, setMyVisible] = useState(true);
  const me = rows?.find((r) => r.is_me);

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
      <div className="flex items-center gap-3 border-b border-slate-200 px-3 pb-1 text-xs uppercase tracking-wide text-slate-500">
        <span className="w-8 text-right">#</span><span className="flex-1">Name</span><span className="w-14 text-right">Points</span><span className="w-12 text-right">Tasks</span>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {me && !myVisible ? <div className="glass-panel sticky top-14 z-10 rounded-lg"><Row r={me} pinned /></div> : null}
        {rows === null ? <p className="p-4 text-sm text-slate-500">Loading…</p> : null}
        {rows?.length === 0 ? <p className="p-4 text-sm text-slate-500">No members yet.</p> : null}
        <ul className="divide-y divide-slate-100">
          {rows?.map((r, i) => (
            <li key={i}>
              {r.is_me ? <div ref={myRef}><Row r={r} /></div> : <Row r={r} />}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
