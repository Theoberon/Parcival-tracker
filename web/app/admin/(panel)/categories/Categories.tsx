'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import { callRpc } from '@/lib/api';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Banner, Category, ContestRow } from '@/lib/types';

const EMPTY = { name: '', points: 1, reference_label: '', reference_hint: '', sort_order: 0 };

function Editor({ cat, lockPoints, frozen, onSaved }: { cat: Category | null; lockPoints: boolean; frozen: boolean; onSaved: () => void }) {
  const [f, setF] = useState(cat ? { name: cat.name, points: cat.points, reference_label: cat.reference_label, reference_hint: cat.reference_hint, sort_order: cat.sort_order } : EMPTY);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await callRpc('upsert_category', {
      p_id: cat?.id ?? null, p_name: f.name, p_points: Number(f.points), p_reference_label: f.reference_label,
      p_reference_hint: f.reference_hint, p_sort_order: Number(f.sort_order),
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: 'error', text: r.message });
    setMsg({ tone: 'success', text: 'Saved.' });
    if (!cat) setF(EMPTY);
    onSaved();
  }

  async function toggle() {
    if (!cat) return;
    const r = await callRpc('set_category_active', { p_id: cat.id, p_active: !cat.active });
    if (!r.ok) setMsg({ tone: 'error', text: r.message }); else onSaved();
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-2 sm:col-span-2">
          <h3 className="font-semibold">{cat ? cat.name : 'Add a category'}</h3>
          {cat && !cat.active ? <Badge>inactive</Badge> : null}
        </div>
        <Field label="Name"><Input required value={f.name} disabled={frozen} onChange={set('name')} /></Field>
        <Field label="Points" hint={lockPoints ? 'Locked: the contest has started. Only the owner can unlock point values.' : undefined}>
          <Input type="number" min={1} required value={f.points} disabled={frozen || lockPoints} onChange={set('points')} />
        </Field>
        <Field label="Reference field label"><Input required value={f.reference_label} disabled={frozen} onChange={set('reference_label')} /></Field>
        <Field label="Example shown under the field"><Input value={f.reference_hint} disabled={frozen} onChange={set('reference_hint')} /></Field>
        <Field label="Sort order"><Input type="number" value={f.sort_order} disabled={frozen} onChange={set('sort_order')} /></Field>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={busy || frozen}>{cat ? 'Save' : 'Add category'}</Button>
          {cat ? <Button type="button" variant="secondary" disabled={frozen} onClick={toggle}>{cat.active ? 'Deactivate' : 'Activate'}</Button> : null}
        </div>
        {msg ? <div className="sm:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      </form>
    </Card>
  );
}

export default function Categories() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [contest, setContest] = useState<ContestRow | null>(null);
  const [status, setStatus] = useState<Banner['status'] | null>(null);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [c, k, b] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order').order('name'),
      supabase.from('contests').select('*').limit(1).maybeSingle(),
      callRpc<Banner[]>('get_contest_banner'),
    ]);
    setCats((c.data as Category[]) ?? []);
    setContest(k.data as ContestRow | null);
    if (b.ok) setStatus(b.data[0]?.status ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const frozen = status === 'final' || status === 'archived';
  const lockPoints = status !== 'setup' && !contest?.points_unlocked;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Categories</h1>
      {frozen ? <Alert tone="info">The contest is final, so categories can no longer change.</Alert> : null}
      {!frozen && lockPoints ? <Alert tone="info">Point values are locked because the contest has started. You can still add categories and edit names, labels and examples.</Alert> : null}
      {cats === null || status === null ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {cats && status ? (
        <>
          {cats.map((c) => <Editor key={c.id + c.name + c.points + c.active} cat={c} lockPoints={lockPoints} frozen={frozen} onSaved={load} />)}
          <Editor cat={null} lockPoints={false} frozen={frozen} onSaved={load} />
        </>
      ) : null}
    </div>
  );
}
