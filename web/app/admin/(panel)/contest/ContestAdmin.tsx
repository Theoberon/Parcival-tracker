'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, H2, Input } from '@/components/ui';
import ReasonModal from '@/components/admin/ReasonModal';
import { callFunction, callRpc } from '@/lib/api';
import { fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Banner, ContestRow } from '@/lib/types';

type Modal =
  | { kind: 'unlock' | 'lock' | 'publish' | 'reopen' | 'archive' }
  | { kind: 'extend'; endAt: string };

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
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const [k, bn] = await Promise.all([
      supabaseBrowser().from('contests').select('*').limit(1).maybeSingle(),
      callRpc<Banner[]>('get_contest_banner'),
    ]);
    const row = k.data as ContestRow | null;
    setC(row);
    setNow(Date.now());
    if (bn.ok) setB(bn.data[0] ?? null);
    if (row) setSetup({ name: row.name, start: toLocalInput(row.start_at), end: toLocalInput(row.end_at), grace: row.grace_minutes });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!c || !b) return <p className="text-sm text-slate-500">Loading…</p>;
  const status = b.status;
  const graceOver = now >  new Date(c.end_at).getTime() + c.grace_minutes * 60_000;
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
          <div><dt className="text-xs uppercase text-slate-500">Starts</dt><dd>{fmtDateTime(c.start_at)}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Ends (+{c.grace_minutes} min grace)</dt><dd>{fmtDateTime(c.end_at)}</dd></div>
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

      {status === 'setup' || status === 'open' || status === 'closed' ? (
        <Card>
          <H2>Extend the deadline</H2>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="New deadline"><Input type="datetime-local" value={extend} onChange={(e) => setExtend(e.target.value)} /></Field>
            <Button disabled={!extend || busy} onClick={() => setModal({ kind: 'extend', endAt: fromLocalInput(extend) })}>Extend…</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">The deadline can only move later. If registration already closed, re-open the Google Form by hand.</p>
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

      {modalProps && modal ? (
        <ReasonModal
          title={modalProps.title}
          description={modalProps.description}
          confirmLabel={modalProps.confirm}
          danger={modalProps.danger}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            const r = await modalProps.go(reason);
            if (r.ok) { setMsg({ tone: 'success', text: `${modalProps.title}: done.` }); load(); return null; }
            return r.message;
          }}
        />
      ) : null}
    </div>
  );
}
