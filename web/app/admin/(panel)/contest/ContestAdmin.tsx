'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, H2, Input } from '@/components/ui';
import ReasonModal from '@/components/admin/ReasonModal';
import { callFunction, callRpc } from '@/lib/api';
import { fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Banner, ContestRow } from '@/lib/types';

type Modal =
  | { kind: 'unlock' | 'lock' | 'publish' | 'reopen' | 'archive' | 'end' }
  | { kind: 'extend'; endAt: string }
  | { kind: 'new'; name: string; startAt: string; endAt: string };

type ContestHistory = {
  source_contest_id: string;
  contest_name: string;
  available_at: string;
  expires_at: string;
  categories: { id: string; name: string }[];
  standings: {
    member_id: string;
    display_name: string;
    title: string | null;
    points: number;
    rank: number | null;
    category_counts: Record<string, number>;
  }[];
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ContestAdmin() {
  const [c, setC] = useState<ContestRow | null>(null);
  const [b, setB] = useState<Banner | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState({ name: '', start: '', end: '', grace: 10 });
  const [extend, setExtend] = useState('');
  const [nextContest, setNextContest] = useState(() => {
    const start = new Date(Date.now() + 7 * 86_400_000);
    const end = new Date(start.getTime() + 30 * 86_400_000);
    return { name: '', start: toLocalInput(start.toISOString()), end: toLocalInput(end.toISOString()) };
  });
  const [history, setHistory] = useState<ContestHistory[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const [k, bn, owner] = await Promise.all([
      supabaseBrowser().from('contests').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      callRpc<Banner[]>('get_contest_banner'),
      callRpc<boolean>('is_owner'),
    ]);
    const row = k.data as ContestRow | null;
    setC(row);
    setNow(Date.now());
    if (bn.ok) setB(bn.data[0] ?? null);
    setIsOwner(owner.ok && owner.data === true);
    if (!owner.ok) {
      setHistory([]);
      setHistoryError(owner.message);
    } else if (!owner.data) {
      setHistory([]);
      setHistoryError('');
    } else {
      const h = await callRpc<ContestHistory[]>('get_contest_history');
      if (h.ok) {
        setHistory(h.data);
        setHistoryError('');
      } else {
        setHistory([]);
        setHistoryError(h.message);
      }
    }
    if (row) setSetup({ name: row.name, start: toLocalInput(row.start_at), end: toLocalInput(row.end_at), grace: row.grace_minutes });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!c || !b) return <p className="text-sm text-slate-500">Loading…</p>;
  const status = b.status;
  const graceOver = Boolean(c.ended_at) || now > new Date(c.end_at).getTime() + c.grace_minutes * 60_000;
  const archiveFrom = c.finalized_at ? new Date(new Date(c.finalized_at).getTime() + 30 * 86_400_000) : null;

  async function run(label: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.ok ? { tone: 'success', text: `${label} done.` } : { tone: 'error', text: r.message ?? 'Failed.' });
    load();
  }

  async function exportCsv() {
    await run('Export', async () => {
      const r = await callFunction<{ standings_csv: string; audit_csv: string; marked: boolean }>('contest-export', { action: 'export' });
      if (!r.ok) return r;
      download('final-standings.csv', r.data.standings_csv);
      download('audit-log.csv', r.data.audit_csv);
      if (!r.data.marked) return { ok: false, message: 'Files downloaded, but the export is only recorded for archiving once results are final.' };
      return { ok: true };
    });
  }

  async function saveSetup(e: React.FormEvent) {
    e.preventDefault();
    await run('Saving', () => callRpc('update_contest_setup', {
      p_name: setup.name, p_start: fromLocalInput(setup.start), p_end: fromLocalInput(setup.end), p_grace: Number(setup.grace),
    }));
  }

  const modalProps = (() => {
    if (!modal) return null;
    switch (modal.kind) {
      case 'extend': return { title: 'Extend the deadline', description: `New deadline: ${fmtDateTime(modal.endAt)}. The deadline can only move later.`, confirm: 'Extend', danger: false,
        go: (reason: string) => callRpc('extend_deadline', { p_new_end: modal.endAt, p_reason: reason }) };
      case 'unlock': return { title: 'Unlock point values', description: 'Allows editing category points after the contest started. Old approvals keep the points they were awarded.', confirm: 'Unlock', danger: true,
        go: (reason: string) => callRpc('set_points_unlocked', { p_unlocked: true, p_reason: reason }) };
      case 'lock': return { title: 'Lock point values again', description: '', confirm: 'Lock', danger: false,
        go: (reason: string) => callRpc('set_points_unlocked', { p_unlocked: false, p_reason: reason }) };
      case 'publish': return { title: status === 'closed' && c.finalized_at ? 'Publish updated final results' : 'Publish final results', description: 'Freezes submissions and categories. Members will see “Final results”.', confirm: 'Publish', danger: true,
        go: (reason: string) => callRpc('publish_final', { p_reason: reason }) };
      case 'reopen': return { title: 'Reopen the contest', description: 'Unfreezes reviewing so corrections can be made. You must publish again afterwards.', confirm: 'Reopen', danger: true,
        go: (reason: string) => callRpc('reopen_contest', { p_reason: reason }) };
      case 'archive': return { title: 'Archive the contest', description: 'PERMANENTLY deletes all screenshots. Make sure you downloaded the export first.', confirm: 'Archive and delete screenshots', danger: true,
        go: (reason: string) => callFunction('contest-export', { action: 'archive', reason }) };
      case 'end': return { title: 'End the contest now?', description: 'This immediately stops new registrations and submissions. Existing submissions remain reviewable; you can publish final results once all pending reviews are complete, without waiting for the scheduled deadline or grace period.', confirm: 'End contest now', danger: true,
        go: (reason: string) => callRpc('end_contest', { p_reason: reason }) };
      case 'new': return { title: 'Start the next contest', description: `Creates "${modal.name}", carries participant accounts and login keys forward, and stops using the current contest. Previous standings will be available to you for seven days after the new contest starts.`, confirm: 'Create next contest', danger: true,
        go: (reason: string) => callRpc('create_next_contest', {
          p_name: modal.name,
          p_start_at: fromLocalInput(modal.startAt),
          p_end_at: fromLocalInput(modal.endAt),
          p_reason: reason,
        }) };
    }
  })();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Contest</h1>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{c.name}</h2>
          <Badge kind={status === 'open' ? 'approved' : status === 'closed' ? 'pending' : 'neutral'}>{status}</Badge>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs uppercase text-slate-500">Contest ID</dt><dd className="break-all font-mono text-xs">{c.id}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Starts</dt><dd>{fmtDateTime(c.start_at)}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Ends (+{c.grace_minutes} min grace)</dt><dd>{fmtDateTime(c.end_at)}</dd></div>
          {c.ended_at ? <div><dt className="text-xs uppercase text-slate-500">Ended early</dt><dd>{fmtDateTime(c.ended_at)}</dd></div> : null}
          <div><dt className="text-xs uppercase text-slate-500">Pending reviews</dt><dd>{b.pending_count}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Point values</dt><dd>{status === 'setup' ? 'Editable' : c.points_unlocked ? 'Unlocked' : 'Locked'}</dd></div>
          {c.finalized_at ? <div><dt className="text-xs uppercase text-slate-500">Results published</dt><dd>{fmtDateTime(c.finalized_at)}</dd></div> : null}
          {c.exported_at ? <div><dt className="text-xs uppercase text-slate-500">Last export</dt><dd>{fmtDateTime(c.exported_at)}</dd></div> : null}
        </dl>
      </Card>

      {status === 'setup' ? (
        <Card>
          <H2>Edit name and dates</H2>
          <form onSubmit={saveSetup} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input required value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
            <Field label="Grace minutes after the deadline"><Input type="number" min={0} value={setup.grace} onChange={(e) => setSetup({ ...setup, grace: Number(e.target.value) })} /></Field>
            <Field label="Starts"><Input type="datetime-local" required value={setup.start} onChange={(e) => setSetup({ ...setup, start: e.target.value })} /></Field>
            <Field label="Ends"><Input type="datetime-local" required value={setup.end} onChange={(e) => setSetup({ ...setup, end: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save</Button>
              <p className="mt-2 text-xs text-slate-500">Confirm the categories and their points before the start time: they lock when the contest starts.</p></div>
          </form>
        </Card>
      ) : null}

      {status === 'setup' || status === 'open' ? (
        <Card>
          <H2>End the contest early</H2>
          <p className="mb-3 text-sm text-slate-600">Stop registrations and submissions now. Pending submissions can still be reviewed before results are published.</p>
          <Button variant="danger" disabled={busy} onClick={() => setModal({ kind: 'end' })}>End contest now…</Button>
        </Card>
      ) : null}

      {status === 'setup' || status === 'open' || status === 'closed' ? (
        <Card>
          <H2>Extend the deadline</H2>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="New deadline"><Input type="datetime-local" value={extend} onChange={(e) => setExtend(e.target.value)} /></Field>
            <Button disabled={!extend || busy} onClick={() => setModal({ kind: 'extend', endAt: fromLocalInput(extend) })}>Extend…</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">The deadline can only move later. Extending a manually ended contest reopens it. If registration already closed, re-open the Google Form by hand.</p>
        </Card>
      ) : null}

      {status !== 'setup' && status !== 'final' && status !== 'archived' ? (
        <Card>
          <H2>Point values</H2>
          <p className="mb-3 text-sm text-slate-600">Point values are locked since the contest started. Unlocking is logged and never changes points already awarded.</p>
          {c.points_unlocked
            ? <Button variant="secondary" onClick={() => setModal({ kind: 'lock' })}>Lock point values again…</Button>
            : <Button variant="secondary" onClick={() => setModal({ kind: 'unlock' })}>Unlock point values…</Button>}
        </Card>
      ) : null}

      {status === 'closed' ? (
        <Card>
          <H2>Publish final results</H2>
          {b.pending_count > 0 ? <Alert tone="warn">{b.pending_count} submission{b.pending_count === 1 ? ' is' : 's are'} still pending. Review them first.</Alert> : null}
          {!graceOver ? <Alert tone="info">The grace period after the deadline is still running (until {fmtDateTime(new Date(new Date(c.end_at).getTime() + c.grace_minutes * 60_000).toISOString())}).</Alert> : null}
          <div className="mt-3"><Button disabled={b.pending_count > 0 || !graceOver} onClick={() => setModal({ kind: 'publish' })}>Publish final results…</Button></div>
        </Card>
      ) : null}

      {status === 'final' ? (
        <>
          <Card>
            <H2>Export</H2>
            <p className="mb-3 text-sm text-slate-600">Downloads the final standings and the full audit log as CSV files, and records the export (required before archiving).</p>
            <Button disabled={busy} onClick={exportCsv}>Download CSVs</Button>
          </Card>
          <Card>
            <H2>Reopen</H2>
            <p className="mb-3 text-sm text-slate-600">Found a mistake? Reopen to correct it, then publish again. Members will see “Results updated”.</p>
            <Button variant="secondary" onClick={() => setModal({ kind: 'reopen' })}>Reopen the contest…</Button>
          </Card>
          <Card>
            <H2>Archive</H2>
            <p className="mb-3 text-sm text-slate-600">Deletes all screenshots for good. Allowed 30 days after results were published{archiveFrom ? ` (from ${fmtDateTime(archiveFrom.toISOString())})` : ''}, and only after an export.</p>
            <Button variant="danger" disabled={busy} onClick={() => setModal({ kind: 'archive' })}>Archive…</Button>
          </Card>
        </>
      ) : null}
      {status === 'archived' ? <Alert tone="info">This contest is archived. Screenshots were deleted; results remain visible.</Alert> : null}

      {isOwner && (status === 'final' || status === 'archived') ? (
        <Card>
          <H2>Start a new contest</H2>
          <p className="mb-3 text-sm text-slate-600">
            The current contest must be final before another can be created. Participant accounts and login keys carry forward.
            Set the new Google Form to use the new contest ID after creation; the old contest will no longer accept submissions.
          </p>
          <form onSubmit={(e) => {
            e.preventDefault();
            setModal({ kind: 'new', name: nextContest.name.trim(), startAt: nextContest.start, endAt: nextContest.end });
          }} className="grid gap-3 sm:grid-cols-2">
            <Field label="Contest name"><Input required maxLength={120} value={nextContest.name} onChange={(e) => setNextContest({ ...nextContest, name: e.target.value })} /></Field>
            <span />
            <Field label="Starts"><Input type="datetime-local" required value={nextContest.start} onChange={(e) => setNextContest({ ...nextContest, start: e.target.value })} /></Field>
            <Field label="Ends"><Input type="datetime-local" required value={nextContest.end} onChange={(e) => setNextContest({ ...nextContest, end: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create next contest…</Button></div>
          </form>
        </Card>
      ) : null}

      {historyError ? <Alert tone="error">Could not load previous contest results: {historyError}</Alert> : null}
      {history.map((past) => (
        <Card key={past.source_contest_id}>
          <details>
            <summary className="cursor-pointer text-lg font-semibold">{past.contest_name} — previous results</summary>
            <p className="mt-2 text-sm text-slate-600">Available until {fmtDateTime(past.expires_at)}. Screenshots and contest records are removed automatically after expiry.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead><tr className="border-b">
                  <th className="px-2 py-2">Rank</th><th className="px-2 py-2">Participant</th><th className="px-2 py-2">Title</th><th className="px-2 py-2">Points</th>
                  {past.categories.map((category) => <th className="px-2 py-2" key={category.id}>{category.name}</th>)}
                </tr></thead>
                <tbody>{past.standings.map((standing) => (
                  <tr className="border-b" key={standing.member_id}>
                    <td className="px-2 py-2">{standing.rank ?? '—'}</td>
                    <td className="px-2 py-2">{standing.display_name}</td>
                    <td className="px-2 py-2">{standing.title ?? '—'}</td>
                    <td className="px-2 py-2">{standing.points}</td>
                    {past.categories.map((category) => (
                      <td className="px-2 py-2" key={category.id}>{standing.category_counts?.[category.id] ?? 0}</td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </Card>
      ))}

      {modalProps && modal ? (
        <ReasonModal
          title={modalProps.title}
          description={modalProps.description}
          confirmLabel={modalProps.confirm}
          danger={modalProps.danger}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            const r = await modalProps.go(reason);
            if (r.ok) {
              setMsg({ tone: 'success', text: `${modalProps.title}: done.` });
              if (modal.kind === 'new') setNextContest((current) => ({ ...current, name: '' }));
              load();
              return null;
            }
            return r.message;
          }}
        />
      ) : null}
    </div>
  );
}
