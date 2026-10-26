'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { loginVia } from '@/lib/api';
import { organizationScopeFromCookie } from '@/lib/organization-scope';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function AdminLoginForm({ notice }: { notice: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const supabase = supabaseBrowser();
    const problem = await loginVia('admin', email.trim().toLowerCase(), password);
    if (problem) {
      setError(problem);
      setBusy(false);
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setError('Email or password is incorrect.');
      setBusy(false);
      return;
    }
    // Only admins may stay logged in here.
    const [{ data: admin }, { data: platformOwner }] = await Promise.all([
      supabase.from('admins').select('id').eq('id', data.user.id).eq('active', true).maybeSingle(),
      supabase.rpc('is_platform_admin'),
    ]);
    if (!admin && platformOwner !== true) {
      await supabase.auth.signOut();
      setError('Email or password is incorrect.');
      setBusy(false);
      return;
    }
    try { localStorage.setItem('admin:lastActive', String(Date.now())); } catch { /* storage may be unavailable */ }
    router.replace(platformOwner === true && !organizationScopeFromCookie(document.cookie) ? '/admin/organizations' : '/admin');
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">Admin login</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {notice ? <Alert tone="warn">{notice}</Alert> : null}
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <span className="relative block">
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  {showPassword ? (
                    <>
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                      <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5 0 8.3 4.5 9 7-.2.8-.8 1.8-1.7 2.8" />
                      <path d="M6.2 6.2C3.8 7.7 2.3 10 2 12c.7 2.5 4 7 10 7 1.1 0 2.1-.2 3-.5" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3.3-7 10-7 10 7 10 7-3.3 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </span>
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Log in'}</Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-slate-500">Forgot your password? Ask the owner to send a reset email.</p>
    </main>
  );
}
