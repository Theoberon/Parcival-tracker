'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card } from '@/components/ui';
import ReasonModal from '@/components/admin/ReasonModal';
import { callFunction, callRpc } from '@/lib/api';
import { fmtDateTime, REJECT_REASONS } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AdminLeaderRow, AdminSubmission } from '@/lib/types';

type Action = { kind: 'reverse' | 'correct' | 'override'; sub: AdminSubmission };
const ACTIONS = {
  reverse: { rpc: 'reverse_submission', title: 'Reverse this approval', confirm: 'Reverse', danger: true,
    desc: 'The points are removed from the member’s total. The member can resubmit if the rules allow.' },
  correct: { rpc: 'correct_rejection', title: 'Correct this rejection', confirm: 'Approve instead', danger: false,
    desc: 'Turns the rejection into an approval and awards the points.' },
  override: { rpc: 'grant_override', title: 'Grant an override', confirm: 'Grant override', danger: false,
    desc: 'Allows this member exactly one more attempt after a final rejection.' },
} as const;

export default function MemberDetail({ id }: { id: string }) {
  const [member, setMember] = useState<AdminLeaderRow | null>(null);
  const [subs, setSubs] = useState<AdminSubmission[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [lb, hist] = await Promise.all([
      callRpc<AdminLeaderRow[]>('get_admin_leaderboard'),
      supabaseBrowser().from('submissions')
        .select('id, reference, status, attempt, override_granted, points_awarded, reject_reason_code, reject_reason_text, submitted_at, created_at, flags, category:categories(name)')
        .eq('member_id', id).neq('status', 'draft').order('created_at', { ascending: false }),
    ]);
    if (lb.ok) setMember(lb.data.find((m) => m.member_id === id) ?? null);
    if (!hist.error) setSubs(hist.data as unknown as AdminSubmission[]);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive() {
    if (!member) return;
    const deactivate = member.active;
    if (!window.confirm(deactivate ? `Deactivate ${member.display_name}? They will be logged out and removed from the leaderboard.` : `Reactivate ${member.display_name}?`)) return;
    setBusy(true);
    setMsg(null);
    const r = await callFunction('admin-manage', { action: deactivate ? 'ban_member' : 'unban_member', id });
    setBusy(false);
    setMsg(r.ok ? { tone: 'success', text: deactivate ? 'Member deactivated.' : 'Member reactivated.' } : { tone: 'error', text: r.message });
    load();
  }

  if (member === null && subs === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!member) return <Alert tone="error">Member not found. <Link className="underline" href="/admin/members">Back</Link></Alert>;

  return (
    <div className="space-y-4">
      <Link href="/admin/members" className="text-sm underline">← Members</Link>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{member.display_name} {!member.active ? <Badge>inactive</Badge> : null}</h1>
            {member.title ? <p className="text-sm font-medium text-slate-700">{member.title}</p> : null}
            <p className="text-sm text-slate-600">{member.email}</p>
            <p className="mt-1 text-sm">{member.points} points · {member.tasks_completed} tasks · rank {member.rank ?? '–'} · {member.pending_count} pending</p>
          </div>
          <Button variant={member.active ? 'danger' : 'secondary'} disabled={busy} onClick={toggleActive}>
            {member.active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </Card>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold">History</h2>
        {subs?.length === 0 ? <p className="text-sm text-slate-500">No submissions yet.</p> : null}
        <ul className="divide-y divide-slate-100">
          {subs?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
              <Badge kind={s.status}>{s.status}</Badge>
              <span className="font-medium">{(s as unknown as { category: { name: string } }).category?.name}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{s.reference}</span>
              {s.attempt > 1 ? <Badge>attempt {s.attempt}</Badge> : null}
              {s.override_granted ? <Badge kind="flag">override granted</Badge> : null}
              {s.status === 'approved' ? <span className="font-semibold text-emerald-300">+{s.points_awarded}</span> : null}
              <span className="text-xs text-slate-500">{fmtDateTime(s.submitted_at ?? s.created_at)}</span>
              {s.reject_reason_code ? (
                <span className="w-full text-xs text-red-300">{REJECT_REASONS[s.reject_reason_code] ?? s.reject_reason_code}{s.reject_reason_text ? `: ${s.reject_reason_text}` : ''}</span>
              ) : null}
              <div className="flex w-full flex-wrap gap-2 pt-1">
                <Link className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50" href={`/admin/review/${s.id}`}>View</Link>
                {s.status === 'approved' ? <Button variant="secondary" className="min-h-7 px-3 py-1 text-xs" onClick={() => setAction({ kind: 'reverse', sub: s })}>Reverse approval</Button> : null}
                {s.status === 'rejected' && s.reject_reason_code !== 'reversed' ? <Button variant="secondary" className="min-h-7 px-3 py-1 text-xs" onClick={() => setAction({ kind: 'correct', sub: s })}>Correct rejection</Button> : null}
                {(s.status === 'rejected' || s.status === 'reversed') && s.attempt >= 2 && !s.override_granted ? (
                  <Button variant="secondary" className="min-h-7 px-3 py-1 text-xs" onClick={() => setAction({ kind: 'override', sub: s })}>Grant override</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {action ? (
        <ReasonModal
          title={ACTIONS[action.kind].title}
          description={`${ACTIONS[action.kind].desc} (${action.sub.reference})`}
          confirmLabel={ACTIONS[action.kind].confirm}
          danger={ACTIONS[action.kind].danger}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            const r = await callRpc(ACTIONS[action.kind].rpc, { p_id: action.sub.id, p_reason: reason });
            if (r.ok) { load(); return null; }
            return r.message;
          }}
        />
      ) : null}
    </div>
  );
}
