'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Card, Page } from '@/components/ui';
import LogoutButton from '@/components/LogoutButton';
import { callRpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Banner, Category, LeaderRow, MySubmission } from '@/lib/types';
import Leaderboard from './Leaderboard';
import MySubmissions from './MySubmissions';
import SubmitPanel from './SubmitPanel';

function BannerView({ banner }: { banner: Banner }) {
  if (banner.status === 'setup') return <Alert tone="info">Submissions open on {fmtDate(banner.start_at)}.</Alert>;
  if (banner.status === 'closed') {
    return <Alert tone="warn">Provisional: {banner.pending_count} submission{banner.pending_count === 1 ? '' : 's'} under review.</Alert>;
  }
  if (banner.status === 'final' || banner.status === 'archived') {
    return (
      <Alert tone="success">
        <strong>Final results.</strong>{banner.results_updated_at ? ` Results updated ${fmtDate(banner.results_updated_at)}.` : ''}
      </Alert>
    );
  }
  return null;
}

export default function Dashboard({ userId, displayName, title }: { userId: string; displayName: string; title?: string | null }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [subs, setSubs] = useState<MySubmission[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [resubmit, setResubmit] = useState<MySubmission | null>(null);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  const loadBoard = useCallback(async () => {
    const [b, l] = await Promise.all([callRpc<Banner[]>('get_contest_banner'), callRpc<LeaderRow[]>('get_leaderboard')]);
    if (b.ok) setBanner(b.data[0] ?? null); else setError(b.message);
    if (l.ok) setBoard(l.data);
  }, []);

  const loadSubs = useCallback(async () => {
    const r = await callRpc<MySubmission[]>('my_submissions');
    if (!r.ok) return setError(r.message);
    setSubs(r.data);
    const paths = r.data.map((s) => s.proof_path);
    if (paths.length) {
      const { data } = await supabaseBrowser().storage.from('proofs').createSignedUrls(paths, 300);
      const map: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
      setThumbs(map);
    }
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    loadBoard();
    loadSubs();
    supabase.from('categories').select('id, name, points, reference_label, reference_hint, active, sort_order')
      .order('sort_order').then(({ data }) => setCats((data as Category[]) ?? []));

    const poll = setInterval(loadBoard, 30_000);
    const channel = supabase.channel('my-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `member_id=eq.${userId}` },
        () => { loadSubs(); loadBoard(); })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') { loadBoard(); loadSubs(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadBoard, loadSubs, userId]);

  const me = board?.find((r) => r.is_me);

  return (
    <Page>
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{banner?.name ?? 'Contest'}</h1>
          <p className="truncate text-sm text-slate-600">Hi, {displayName}{title ? ` · ${title}` : ''}</p>
        </div>
        <LogoutButton />
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {banner ? <BannerView banner={banner} /> : null}

      <Card>
        <div className="grid grid-cols-2 gap-4 text-center">
          <div><p className="text-xs uppercase tracking-wide text-slate-500">My points</p><p className="text-3xl font-semibold tabular-nums">{me?.points ?? 0}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">My rank</p><p className="text-3xl font-semibold tabular-nums">{me?.rank ? `#${me.rank}` : <span className="text-base font-medium text-slate-500">Not ranked yet</span>}</p></div>
        </div>
      </Card>

      <Leaderboard rows={board} />

      <div ref={formRef}>
        <SubmitPanel
          status={banner?.status}
          startAt={banner?.start_at}
          categories={cats}
          resubmit={resubmit}
          onCancelResubmit={() => setResubmit(null)}
          onSubmitted={() => { loadSubs(); loadBoard(); }}
        />
      </div>

      <MySubmissions
        subs={subs}
        thumbs={thumbs}
        onChanged={() => { loadSubs(); loadBoard(); }}
        onResubmit={(s) => { setResubmit(s); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
      />
    </Page>
  );
}
