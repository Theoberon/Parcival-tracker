'use client';
import { useState } from 'react';
import { Alert, Button, Textarea } from '../ui';

/** Asks for a reason (required) before a logged action. onConfirm returns an error message or null. */
export default function ReasonModal(props: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError('A reason is required.');
    setBusy(true);
    const err = await props.onConfirm(reason.trim());
    setBusy(false);
    if (err) setError(err); else props.onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
      <form onSubmit={go} className="glass-panel w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-2xl">
        <h3 className="text-base font-semibold">{props.title}</h3>
        {props.description ? <p className="text-sm text-slate-600">{props.description}</p> : null}
        <Textarea autoFocus rows={3} placeholder="Reason (saved in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={props.danger ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Working…' : props.confirmLabel}</Button>
        </div>
      </form>
    </div>
  );
}
