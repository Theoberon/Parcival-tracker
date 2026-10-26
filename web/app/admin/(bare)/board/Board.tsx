'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callRpc } from '@/lib/api';
import CategoryIcon from '@/components/CategoryIcon';
import type { Category } from '@/lib/types';

interface RunningLeaderboardRow {
  organization_id: string;
  organization_name: string;
  is_current_organization: boolean;
  contest_id: string;
  contest_name: string;
  start_at: string;
  end_at: string;
  categories: Category[];
  member_id: string | null;
  display_name: string | null;
  points: number | null;
  tasks_completed: number | null;
  rank: number | null;
  is_me: boolean;
  category_counts: Record<string, number> | null;
  member_order: number | null;
}

interface OrganizationLeaderboard {
  organizationId: string;
  organizationName: string;
  isCurrentOrganization: boolean;
  contestId: string;
  contestName: string;
  categories: Category[];
  rows: RunningLeaderboardRow[];
}

function groupLeaderboards(rows: RunningLeaderboardRow[]): OrganizationLeaderboard[] {
  const groups = new Map<string, OrganizationLeaderboard>();
  for (const row of rows) {
    let group = groups.get(row.contest_id);
    if (!group) {
      group = {
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        isCurrentOrganization: row.is_current_organization,
        contestId: row.contest_id,
        contestName: row.contest_name,
        categories: row.categories,
        rows: [],
      };
      groups.set(row.contest_id, group);
    }
    if (row.member_id && row.display_name !== null) group.rows.push(row);
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.isCurrentOrganization) - Number(a.isCurrentOrganization)
      || a.organizationName.localeCompare(b.organizationName),
  );
}

export default function Board() {
  const [rows, setRows] = useState<RunningLeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callRpc<RunningLeaderboardRow[]>('get_running_organization_leaderboards');
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setRows(result.data);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const leaderboards = useMemo(() => rows ? groupLeaderboards(rows) : null, [rows]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white sm:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold sm:text-5xl">Running organisation leaderboards</h1>
            <p className="mt-2 text-sm text-slate-400"></p>
          </div>
          <Link href="/admin" className="text-sm text-slate-300 underline">Back to admin</Link>
        </div>

        {error ? <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-rose-100">{error}</p> : null}
        {leaderboards === null && !error ? <p className="text-slate-400">Loading leaderboards…</p> : null}
        {leaderboards?.length === 0 ? <p className="rounded-xl border border-white/10 p-6 text-slate-300">There are no running organisation contests right now.</p> : null}

        <div className="space-y-6">
          {leaderboards?.map((board) => {
            const categories = board.categories.filter((category) => category.active)
              .sort((a, b) => a.sort_order - b.sort_order);
            const gridTemplateColumns = `3rem minmax(12rem, 1fr) repeat(${categories.length}, 4rem) 5rem`;
            return (
              <section key={board.contestId} aria-label={`${board.organizationName} leaderboard`} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 px-5 py-4">
                  <div>
                    <h2 className="text-xl font-semibold sm:text-2xl">{board.organizationName}</h2>
                    <p className="mt-1 text-sm text-slate-400">{board.contestName} · Live</p>
                  </div>
                  {board.isCurrentOrganization ? <span className="rounded-full bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-100">Your organisation</span> : null}
                </header>
                <div className="overflow-x-auto p-5">
                  <div className="min-w-max">
                    <div className="mb-2 grid items-center gap-4 border-b border-white/10 pb-2 text-sm uppercase tracking-wider text-slate-300" style={{ gridTemplateColumns }}>
                      <span className="text-right">#</span>
                      <span>Name</span>
                      {categories.map((category) => (
                        <span key={category.id} className="text-center" title={category.name} aria-label={category.name}>
                          <CategoryIcon name={category.name} />
                          <span className="sr-only">{category.name}</span>
                        </span>
                      ))}
                      <span className="text-right">Points</span>
                    </div>
                    {board.rows.length ? (
                      <ol className="divide-y divide-white/10">
                        {board.rows.map((row) => (
                          <li key={row.member_id} className={`grid items-center gap-4 py-3 text-lg sm:text-xl ${row.rank === 1 ? 'text-amber-300' : row.rank === 2 ? 'text-slate-200' : row.rank === 3 ? 'text-orange-300' : ''} ${row.rank === null ? 'text-slate-500' : ''}`} style={{ gridTemplateColumns }}>
                            <span className="text-right tabular-nums">{row.rank ?? ''}</span>
                            <span className="truncate font-medium">{row.display_name}</span>
                            {categories.map((category) => (
                              <span key={category.id} className="text-center tabular-nums">{row.category_counts?.[category.id] ?? 0}</span>
                            ))}
                            <span className="text-right font-semibold tabular-nums">{row.points ?? 0}</span>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="py-4 text-slate-400">No active participants yet.</p>}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        <div className="mt-10 text-sm text-slate-400">
          <button className="underline" onClick={() => document.documentElement.requestFullscreen?.()}>Full screen</button>
        </div>
      </div>
    </main>
  );
}
