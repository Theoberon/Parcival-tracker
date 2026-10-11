'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { loginVia } from '@/lib/api';
import { formatKeyInput } from '@/lib/key';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    // Server-side attempt counter: after repeated failures the next try has to wait (1, 2, 3 ... minutes).
    const problem = await loginVia('member', email.trim().toLowerCase(), key);
    if (problem) {
      setError(problem);
      setBusy(false);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">Contest login</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Login key" hint="The key from your registration email. Dashes and spaces are optional.">
            <Input
              required
              autoComplete="current-password"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX"
              className="font-mono tracking-wider"
              value={key}
              onChange={(e) => setKey(formatKeyInput(e.target.value))}
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Log in'}</Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        Lost your key? <Link className="font-medium underline" href="/resend">Resend my key</Link>
      </p>
    </main>
  );
}
