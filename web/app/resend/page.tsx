'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { callFunction } from '@/lib/api';

const GENERIC = 'If this email is registered, a new key has been sent.';

export default function ResendPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const r = await callFunction<{ message: string }>('request-new-key', { email: email.trim() });
    setBusy(false);
    if (r.ok) setResult({ tone: 'success', text: r.data.message || GENERIC });
    else if (r.code === 'invalid_email') setResult({ tone: 'error', text: 'Enter a valid email address.' });
    else setResult({ tone: 'error', text: 'Could not send the request. Please try again.' });
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-2 text-center text-2xl font-semibold">Resend my key</h1>
      <p className="mb-6 text-center text-sm text-slate-600">We email a brand-new key. Your old key stops working.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email you registered with">
            <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Sending…' : 'Send me a new key'}</Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm"><Link className="underline" href="/login">Back to login</Link></p>
    </main>
  );
}
