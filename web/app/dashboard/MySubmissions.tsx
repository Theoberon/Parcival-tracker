'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, H2 } from '@/components/ui';
import { callRpc } from '@/lib/api';
import { fmtDateTime, REJECT_REASONS } from '@/lib/format';
import type { MySubmission } from '@/lib/types';

const LABEL: Record<string, string> = {
  pending: 'Under review', approved: 'Approved', rejected: 'Rejected', reversed: 'Reversed', withdrawn: 'Withdrawn',
};
const BLOCK_TEXT: Record<string, string> = {
  resubmission_limit: 'Already resubmitted once. Ask an admin for an override.',
  resubmission_exists: 'A resubmission already exists.',
  submissions_closed: 'Submissions are closed.',
};

export default function MySubmissions(props: {
  subs: MySubmission[] | null;
  thumbs: Record<string, string>;
  onResubmit: (s: MySubmission) => void;
  onChanged: () => void;
}) {
  const { subs, thumbs } = props;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function withdraw(s: MySubmission) {
    if (!window.confirm('Withdraw this submission?')) return;
    setBusyId(s.id);
    setError('');
    const r = await callRpc('withdraw_submission', { p_id: s.id });
    setBusyId(null);
    if (!r.ok) setError(r.message);
    props.onChanged();
  }

  return (
    <Card>
      <H2>My submissions</H2>
      {error ? <div className="mb-3"><Alert tone="error">{error}</Alert></div> : null}
      {subs === null ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {subs?.length === 0 ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Nothing submitted yet.</p>
          <p>Complete a task on Fiverr, take a screenshot as proof, then use “Submit a task” above: pick the category, enter the reference (account name, gig title, buyer + date or order number) and upload the screenshot. An admin checks it and approved tasks add points to your score.</p>
        </div>
      ) : null}
      <ul className="space-y-3">
        {subs?.map((s) => (
          <li key={s.id} className="flex gap-3 rounded-lg border border-slate-200 p-3">
            {thumbs[s.proof_path] ? (
              <a href={thumbs[s.proof_path]} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbs[s.proof_path]} alt="Screenshot" className="h-16 w-16 rounded-md border border-slate-200 object-cover" />
              </a>
            ) : <div className="h-16 w-16 shrink-0 rounded-md bg-slate-100" />}
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.category_name}</span>
                <Badge kind={s.status}>{LABEL[s.status] ?? s.status}</Badge>
                {s.status === 'approved' ? <span className="font-semibold text-emerald-300">+{s.points_awarded}</span> : null}
                {s.attempt > 1 ? <Badge>Attempt {s.attempt}</Badge> : null}
              </div>
              <p className="truncate text-slate-700">{s.reference}</p>
              <p className="text-xs text-slate-500">{fmtDateTime(s.submitted_at ?? s.created_at)}</p>
              {s.status === 'rejected' || s.status === 'reversed' ? (
                <p className="text-xs text-red-300">
                  {REJECT_REASONS[s.reject_reason_code ?? ''] ?? 'Rejected'}{s.reject_reason_text ? `: ${s.reject_reason_text}` : ''}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {s.status === 'pending' ? (
                  <Button variant="secondary" className="min-h-8 px-3 py-1" disabled={busyId === s.id} onClick={() => withdraw(s)}>Withdraw</Button>
                ) : null}
                {s.can_resubmit ? (
                  <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => props.onResubmit(s)}>Resubmit</Button>
                ) : null}
                {(s.status === 'rejected' || s.status === 'reversed') && !s.can_resubmit && s.resubmit_block ? (
                  <span className="text-xs text-slate-500">{BLOCK_TEXT[s.resubmit_block] ?? ''}</span>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
