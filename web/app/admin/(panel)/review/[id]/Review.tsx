'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, H2, Select, Textarea } from '@/components/ui';
import { callRpc } from '@/lib/api';
import { fmtDateTime, REJECT_REASONS } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AdminSubmission } from '@/lib/types';

const PRESETS = ['unclear_screenshot', 'wrong_category', 'incomplete', 'duplicate', 'staged_self_generated', 'other'];

function Proof({ url, label }: { url: string | undefined; label: string }) {
  const [zoom, setZoom] = useState(false);
  if (!url) return <div className="flex h-40 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">Screenshot not available</div>;
  return (
    <div className="space-y-1">
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} onClick={() => setZoom((z) => !z)}
          className={`${zoom ? 'max-w-none w-[220%] cursor-zoom-out' : 'w-full cursor-zoom-in'} h-auto`} />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{zoom ? 'Click to fit' : 'Click to zoom'}</span>
        <a className="underline" href={url} target="_blank" rel="noreferrer">Open full size</a>
      </div>
    </div>
  );
}

export default function Review({ id }: { id: string }) {
  const router = useRouter();
  const [sub, setSub] = useState<AdminSubmission | null>(null);
  const [parent, setParent] = useState<AdminSubmission | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [holder, setHolder] = useState<{ mine: boolean; email?: string; until?: string } | null>(null);
  const [error, setError] = useState('');
  const [taken, setTaken] = useState(false);       // "already reviewed"
  const [rejecting, setRejecting] = useState(false);
  const [code, setCode] = useState('unclear_screenshot');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.from('submissions')
      .select('*, member:members(display_name, email, title), category:categories(name, points, reference_label)')
      .eq('id', id).maybeSingle();
    if (error || !data) return setMissing(true);
    const s = data as unknown as AdminSubmission;
    setSub(s);
    const paths = [s.proof_path];
    if (s.resubmission_of) {
      const { data: p } = await supabase.from('submissions')
        .select('id, reference, proof_path, attempt, reject_reason_code, reject_reason_text, reviewed_at').eq('id', s.resubmission_of).maybeSingle();
      if (p) { setParent(p as unknown as AdminSubmission); paths.push((p as { proof_path: string }).proof_path); }
    }
    const { data: signed } = await supabase.storage.from('proofs').createSignedUrls(paths, 300);
    const map: Record<string, string> = {};
    for (const d of signed ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
    setUrls(map);
    return s;
  }, [id]);

  const claim = useCallback(async () => {
    const r = await callRpc<{ mine: boolean; claimed_by: string; claimed_until: string }>('claim_submission', { p_id: id });
    if (!r.ok) {
      if (r.code === 'already_reviewed') setTaken(true); else setError(r.message);
      return;
    }
    if (r.data.mine) return setHolder({ mine: true, until: r.data.claimed_until });
    const { data } = await supabaseBrowser().from('admins').select('email').eq('id', r.data.claimed_by).maybeSingle();
    setHolder({ mine: false, email: (data as { email: string } | null)?.email ?? 'another admin', until: r.data.claimed_until });
  }, [id]);

  useEffect(() => {
    load().then((s) => { if (s && s.status === 'pending') claim(); });
    const keep = setInterval(() => { claim(); }, 4 * 60_000);   // keep the 5-minute hold alive while the page is open
    return () => clearInterval(keep);
  }, [load, claim]);

  async function decide(kind: 'approve' | 'reject') {
    setBusy(true);
    setError('');
    const r = kind === 'approve'
      ? await callRpc('approve_submission', { p_id: id })
      : await callRpc('reject_submission', { p_id: id, p_reason_code: code, p_reason_text: text.trim() || null });
    setBusy(false);
    if (r.ok) return router.push('/admin');
    if (r.code === 'already_reviewed') return setTaken(true);
    setError(r.message);
  }

  if (missing) return <Alert tone="error">Submission not found. <Link className="underline" href="/admin">Back to the queue</Link></Alert>;
  if (!sub) return <p className="text-sm text-slate-500">Loading…</p>;

  const pending = sub.status === 'pending' && !taken;
  const blocked = holder !== null && !holder.mine;
  const finalWarning = sub.attempt >= 2 && !sub.override_granted;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/admin" className="text-sm underline">← Queue</Link>
        <Badge kind={sub.status}>{taken ? 'already reviewed' : sub.status}</Badge>
      </div>

      {taken ? (
        <Alert tone="warn">Someone else already reviewed this submission. <Link className="underline" href="/admin">Back to the queue</Link></Alert>
      ) : null}
      {pending && blocked ? (
        <Alert tone="warn">Being reviewed by {holder?.email} (hold until {fmtDateTime(holder?.until)}). You can look, but not decide until the hold ends.</Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          {parent ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-slate-500">Previous attempt (rejected)</p>
                <Proof url={urls[parent.proof_path]} label="Previous screenshot" />
                <p className="mt-1 text-xs text-red-300">
                  {REJECT_REASONS[parent.reject_reason_code ?? ''] ?? parent.reject_reason_code}{parent.reject_reason_text ? `: ${parent.reject_reason_text}` : ''}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-slate-500">This submission</p>
                <Proof url={urls[sub.proof_path]} label="Screenshot" />
              </div>
            </div>
          ) : <Proof url={urls[sub.proof_path]} label="Screenshot" />}
        </Card>

        <div className="space-y-4">
          <Card>
            <H2>Details</H2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs uppercase text-slate-500">Member</dt><dd className="font-medium">{sub.member?.display_name}{sub.member?.title ? <span className="block text-sm font-normal text-slate-500">{sub.member.title}</span> : null}</dd></div>
              <div><dt className="text-xs uppercase text-slate-500">Category</dt><dd>{sub.category?.name} · {sub.category?.points} pt</dd></div>
              <div><dt className="text-xs uppercase text-slate-500">{sub.category?.reference_label}</dt><dd className="break-words font-medium">{sub.reference}</dd></div>
              {sub.note ? <div><dt className="text-xs uppercase text-slate-500">Note</dt><dd className="break-words">{sub.note}</dd></div> : null}
              <div><dt className="text-xs uppercase text-slate-500">Submitted</dt><dd>{fmtDateTime(sub.submitted_at)}</dd></div>
              <div className="flex flex-wrap gap-2">
                {sub.attempt > 1 ? <Badge kind="flag">Resubmission (attempt {sub.attempt})</Badge> : null}
                {sub.flags?.includes('reused_proof') ? <Badge kind="flag">Screenshot reused on another submission</Badge> : null}
              </div>
              {sub.status !== 'pending' ? (
                <div><dt className="text-xs uppercase text-slate-500">Decision</dt>
                  <dd>{sub.status}{sub.points_awarded ? ` (+${sub.points_awarded})` : ''}{sub.reject_reason_code ? ` · ${REJECT_REASONS[sub.reject_reason_code] ?? sub.reject_reason_code}` : ''}{sub.reject_reason_text ? `: ${sub.reject_reason_text}` : ''}</dd></div>
              ) : null}
            </dl>
          </Card>

          {pending ? (
            <Card>
              {!rejecting ? (
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy || blocked} onClick={() => decide('approve')}>Approve (+{sub.category?.points})</Button>
                  <Button variant="secondary" className="flex-1" disabled={busy || blocked} onClick={() => setRejecting(true)}>Reject…</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Reason">
                    <Select value={code} onChange={(e) => setCode(e.target.value)}>
                      {PRESETS.map((p) => <option key={p} value={p}>{REJECT_REASONS[p]}</option>)}
                    </Select>
                  </Field>
                  <Field label={code === 'other' ? 'Explain (required)' : 'Message to the member (optional)'}>
                    <Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                  </Field>
                  {finalWarning ? <Alert tone="warn"><strong>Rejecting this is final.</strong> It was already resubmitted once, so the member cannot resubmit again unless you grant an override later.</Alert> : null}
                  <div className="flex gap-2">
                    <Button variant="danger" className="flex-1" disabled={busy || (code === 'other' && !text.trim())} onClick={() => decide('reject')}>Confirm reject</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
                  </div>
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
