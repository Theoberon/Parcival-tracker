'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/browser';

// Reached from the invite / reset email via /auth/confirm, which has already created the session.
export default function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== again) return setError('The passwords do not match.');
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) {
      setError('Could not save the password. Ask the owner for a new link.');
      setBusy(false);
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">Choose your admin password</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repeat password">
            <Input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save password'}</Button>
        </form>
      </Card>
    </main>
  );
}
