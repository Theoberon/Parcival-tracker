'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { AuditRow } from '@/lib/types';

const PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [f, setF] = useState({ member: '', action: '', entity: '', from: '', to: '' });
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(async (filters: typeof f, beforeId?: number) => {
    let q = supabaseBrowser().from('audit_log').select('*').order('id', { ascending: false }).limit(PAGE + 1);
    if (beforeId) q = q.lt('id', beforeId);
    if (filters.action.trim()) q = q.ilike('action', `%${filters.action.trim().replace(/[%,()]/g, '')}%`);
    if (filters.entity) q = q.eq('entity', filters.entity);
    if (filters.member && UUID.test(filters.member)) {
      q = q.or(`entity_id.eq.${filters.member},actor_id.eq.${filters.member},after->>member_id.eq.${filters.member}`);
    }
    if (filters.from) q = q.gte('created_at', new Date(filters.from).toISOString());
    if (filters.to) q = q.lte('created_at', new Date(filters.to + 'T23:59:59').toISOString());
    return q;
  }, []);

  const run = useCallback(async (filters: typeof f) => {
    setLoading(true);
    setError('');
    const { data, error } = await query(filters);
    setLoading(false);
    if (error) return setError('Could not load the log.');
    setRows((data as AuditRow[]).slice(0, PAGE));
    setMore((data?.length ?? 0) > PAGE);
  }, [query]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    run({ member: '', action: '', entity: '', from: '', to: '' });
    Promise.all([supabase.from('members').select('id, display_name').order('display_name'), supabase.from('admins').select('id, email')]).then(([m, a]) => {
      setMembers((m.data as { id: string; display_name: string }[]) ?? []);
      const map: Record<string, string> = {};
      (m.data as { id: string; display_name: string }[] | null)?.forEach((x) => (map[x.id] = x.display_name));
      (a.data as { id: string; email: string }[] | null)?.forEach((x) => (map[x.id] = x.email));
      setNames(map);
    });
  }, [run]);

  async function loadMore() {
    setLoading(true);
    const { data } = await query(f, rows[rows.length - 1]?.id);
    setLoading(false);
    if (!data) return;
    setRows([...rows, ...(data as AuditRow[]).slice(0, PAGE)]);
    setMore(data.length > PAGE);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <Card>
        <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run(f); }}>
          <Field label="Member">
            <Select value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })}>
              <option value="">All</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </Select>
          </Field>
          <Field label="Action contains"><Input placeholder="approved" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
          <Field label="Entity">
            <Select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
              <option value="">All</option>
              {['submissions', 'members', 'categories', 'contests', 'admins'].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <div className="sm:col-span-5"><Button type="submit" disabled={loading}>Apply filters</Button></div>
        </form>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="glass-panel overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Reason / details</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{fmtDateTime(r.created_at)}</td>
                <td className="px-3 py-2">
                  <Badge kind={r.actor_type === 'system' ? 'neutral' : r.actor_type === 'admin' ? 'approved' : 'pending'}>{r.actor_type}</Badge>{' '}
                  <span className="text-xs">{r.actor_id ? names[r.actor_id] ?? r.actor_id.slice(0, 8) : ''}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">
                  {r.reason ? <p className="text-slate-700">{r.reason}</p> : null}
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer">{r.entity} {r.entity_id?.slice(0, 8)}</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !loading ? <p className="text-sm text-slate-500">No entries.</p> : null}
      {more ? <Button variant="secondary" disabled={loading} onClick={loadMore}>Load more</Button> : null}
    </div>
  );
}
