'use client';
import imageCompression from 'browser-image-compression';
import { useState } from 'react';
import { Alert, Button, Card, Field, H2, Input, Select, Textarea } from '@/components/ui';
import { callFunction } from '@/lib/api';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Category, ContestStatus, MySubmission } from '@/lib/types';
import { fmtDate } from '@/lib/format';

const MAX_PICK_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
type Step = 'idle' | 'compressing' | 'creating' | 'uploading' | 'confirming';
interface Pending { id: string; path: string; token: string; file: File }

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  compressing: 'Preparing screenshot…',
  creating: 'Creating submission…',
  uploading: 'Uploading screenshot…',
  confirming: 'Finishing…',
};

function extOf(file: File): string | null {
  return ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as Record<string, string>)[file.type] ?? null;
}

interface PanelProps {
  status: ContestStatus | undefined;
  startAt: string | undefined;
  categories: Category[];
  resubmit: MySubmission | null;
  onCancelResubmit: () => void;
  onSubmitted: () => void;
}

export default function SubmitPanel(props: PanelProps) {
  const [done, setDone] = useState(false);
  const open = props.status === 'open';
  return (
    <Card>
      <H2>{props.resubmit ? 'Resubmit' : 'Submit a task'}</H2>
      {done ? <div className="mb-3"><Alert tone="success">Submitted. An admin will review it soon.</Alert></div> : null}
      {props.status === 'setup' ? (
        <Alert tone="info">Submissions open on {fmtDate(props.startAt)}.</Alert>
      ) : !open ? (
        <Alert tone="info">Submissions are closed.</Alert>
      ) : (
        // keyed: picking "Resubmit" on a rejected item starts a fresh form pre-filled from it
        <SubmitForm key={props.resubmit?.id ?? 'new'} {...props} onStart={() => setDone(false)} onDone={() => setDone(true)} />
      )}
    </Card>
  );
}

function SubmitForm(props: PanelProps & { onStart: () => void; onDone: () => void }) {
  const { categories, resubmit } = props;
  const [categoryId, setCategoryId] = useState(resubmit?.category_id ?? '');
  const [reference, setReference] = useState(resubmit?.reference ?? '');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const category = categories.find((c) => c.id === categoryId);
  const busy = step !== 'idle';

  function onPickFile(f: File | null) {
    setError('');
    if (f && f.size > MAX_PICK_BYTES) {
      setError('That file is over 5 MB. Choose a smaller screenshot.');
      setFile(null);
      setFileKey((k) => k + 1);
      return;
    }
    setFile(f);
  }

  function reset() {
    setReference(''); setNote(''); setFile(null); setPending(null); setFileKey((k) => k + 1);
    if (resubmit) props.onCancelResubmit();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    props.onStart();
    let p = pending;
    try {
      if (!p) {
        if (!category) return setError('Choose a category.');
        if (!reference.trim()) return setError(`${category.reference_label} is required.`);
        if (!file) return setError('Add a screenshot.');

        setStep('compressing');
        let prepared: File = file;
        try {
          prepared = await imageCompression(file, {
            maxWidthOrHeight: 1600, maxSizeMB: 0.5, fileType: 'image/webp', useWebWorker: true, initialQuality: 0.8,
          });
        } catch {
          setStep('idle');
          return setError('Could not read that image. Try another screenshot.');
        }
        const ext = extOf(prepared);
        if (!ext || prepared.size > MAX_UPLOAD_BYTES) {
          setStep('idle');
          return setError('Could not shrink that image enough. Try a smaller screenshot.');
        }

        setStep('creating');
        const r = await callFunction<{ submission_id: string; path: string; token: string }>('create-submission-draft', {
          category_id: category.id,
          reference: reference.trim(),
          note: note.trim() || null,
          file_ext: ext,
          resubmission_of: resubmit?.id ?? null,
        });
        if (!r.ok) {
          setStep('idle');
          return setError(r.message);
        }
        p = { id: r.data.submission_id, path: r.data.path, token: r.data.token, file: prepared };
        setPending(p);
      }

      setStep('uploading');
      const { error: upErr } = await supabaseBrowser().storage.from('proofs')
        .uploadToSignedUrl(p.path, p.token, p.file, { contentType: p.file.type });
      if (upErr) {
        setStep('idle');
        return setError('The upload did not finish. Check your connection, then press Retry.');
      }

      setStep('confirming');
      const c = await callFunction('confirm-submission', { submission_id: p.id });
      setStep('idle');
      if (!c.ok) {
        if (c.code === 'upload_missing') return setError(c.message + ' Press Retry.');
        setPending(null);   // the draft is gone or unusable: start over
        return setError(c.message);
      }
      reset();
      props.onDone();
      props.onSubmitted();
    } catch {
      setStep('idle');
      setError('Something went wrong. Please try again.');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {resubmit ? (
        <Alert tone="warn">
          Resubmitting your rejected {resubmit.category_name} ({resubmit.reference}).{' '}
          <button type="button" className="underline" onClick={() => { reset(); }}>Cancel</button>
        </Alert>
      ) : null}
      <Field label="Category">
        <Select required value={categoryId} disabled={busy || !!pending || !!resubmit} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Choose…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.points} pt{c.points === 1 ? '' : 's'})</option>)}
        </Select>
      </Field>
      <Field label={category?.reference_label ?? 'Reference'} hint={category?.reference_hint ? `e.g. ${category.reference_hint}` : undefined}>
        <Input required maxLength={200} value={reference} disabled={busy || !!pending} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label="Screenshot proof" hint="JPG, PNG or WebP, up to 5 MB.">
        <Input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !!pending}
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Note (optional)" hint={`${note.length}/280`}>
        <Textarea rows={2} maxLength={280} value={note} disabled={busy || !!pending} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {busy ? <Alert tone="info">{STEP_LABEL[step]}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="flex-1">{pending ? 'Retry' : 'Submit'}</Button>
        {pending && !busy ? <Button type="button" variant="secondary" onClick={() => { setPending(null); setError(''); }}>Start over</Button> : null}
      </div>
    </form>
  );
}
