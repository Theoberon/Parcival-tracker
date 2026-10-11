'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, H2, Input, Select } from '@/components/ui';
import { callFunction } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AdminRow } from '@/lib/types';

export default function Admins({ meId }: { meId: string }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('admins').select('*').order('created_at');
    setRows((data as AdminRow[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    const r = await callFunction('admin-manage', body);
    setBusy(false);
    setMsg(r.ok ? { tone: 'success', text: ok } : { tone: 'error', text: r.message });
    if (r.ok) load();
    return r.ok;
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (await act({ action: 'invite_admin', email, role }, `Invite sent to ${email.trim()}.`)) setEmail('');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admins</h1>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Card>
        <H2>Invite an admin</H2>
        <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'owner')}>
              <option value="admin">Admin</option><option value="owner">Owner</option>
            </Select>
          </Field>
          <Button type="submit" disabled={busy}>Send invite</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">They get an email to choose a password. Admin emails cannot also be contest members.</p>
      </Card>
      <Card>
        <H2>Current admins</H2>
        {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : null}
        <ul className="divide-y divide-slate-100">
          {rows?.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-2 py-3 text-sm ${a.active ? '' : 'text-slate-400'}`}>
              <span className="min-w-0 flex-1 truncate font-medium">{a.email}{a.id === meId ? ' (you)' : ''}</span>
              <Badge>{a.role}</Badge>
              {!a.active ? <Badge>removed</Badge> : null}
              <span className="text-xs text-slate-500">since {fmtDate(a.created_at)}</span>
              {a.id !== meId ? (
                a.active ? (
                  <>
                    <Button variant="secondary" className="min-h-8 px-3 py-1" disabled={busy}
                      onClick={() => window.confirm(`Send ${a.email} a password reset email?`) && act({ action: 'reset_admin_password', id: a.id }, 'Reset email sent.')}>Reset password</Button>
                    <Button variant="danger" className="min-h-8 px-3 py-1" disabled={busy}
                      onClick={() => window.confirm(`Remove ${a.email}? They lose access immediately.`) && act({ action: 'remove_admin', id: a.id }, 'Admin removed.')}>Remove</Button>
                  </>
                ) : (
                  <Button variant="secondary" className="min-h-8 px-3 py-1" disabled={busy} onClick={() => act({ action: 'restore_admin', id: a.id }, 'Admin restored.')}>Restore</Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
