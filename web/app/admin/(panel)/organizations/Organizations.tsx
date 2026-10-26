'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, Field, H2, Input } from '@/components/ui';
import { callRpc } from '@/lib/api';
import { setOrganizationScope } from '@/lib/organization-scope';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Organization = { id: string; name: string; slug: string; created_at: string };
type CreatedOrganization = { organization_id: string; contest_id: string };

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function slugFromName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export default function Organizations({ selectedId }: { selectedId: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<Organization[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [contestName, setContestName] = useState('Contest 1');
  const [startAt, setStartAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 86_400_000)));
  const [endAt, setEndAt] = useState(() => localDateTime(new Date(Date.now() + 37 * 86_400_000)));
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabaseBrowser()
      .from('organizations').select('id,name,slug,created_at').order('created_at', { ascending: false });
    if (error) {
      setRows(null);
      setLoadError('Could not load organisations. Please try again.');
      return;
    }
    setRows((data as Organization[]) ?? []);
    setLoadError('');
  }

  useEffect(() => { void load(); }, []);

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await callRpc<CreatedOrganization[]>('platform_owner_create_organization', {
      p_name: name.trim(),
      p_slug: slug.trim().toLowerCase(),
      p_contest_name: contestName.trim(),
      p_start_at: new Date(startAt).toISOString(),
      p_end_at: new Date(endAt).toISOString(),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      return;
    }
    const created = result.data[0];
    if (!created?.organization_id) {
      setMessage({ tone: 'error', text: 'The organisation was created but no organisation ID was returned. Refresh the page and choose it from the list.' });
      await load();
      return;
    }
    setMessage({ tone: 'success', text: `${name.trim()} created with its contest and default task categories.` });
    setOrganizationScope(created.organization_id);
    router.push('/admin/contest');
    router.refresh();
  }

  function manage(organizationId: string) {
    setOrganizationScope(organizationId);
    router.push('/admin/contest');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Organisations</h1>
        <p className="mt-1 text-sm text-slate-600">Create a separate contest space, then switch into it to manage its contest and admins.</p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Card>
        <H2>Create an organisation</H2>
        <form onSubmit={createOrganization} className="grid gap-3 sm:grid-cols-2">
          <Field label="Organisation name">
            <Input required maxLength={120} value={name} onChange={(event) => {
              setName(event.target.value);
              if (!slugEdited) setSlug(slugFromName(event.target.value));
            }} />
          </Field>
          <Field label="URL-safe slug" hint="2–60 lowercase letters, numbers, or single hyphens.">
            <Input required minLength={2} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug}
              onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} />
          </Field>
          <Field label="First contest name">
            <Input required maxLength={120} value={contestName} onChange={(event) => setContestName(event.target.value)} />
          </Field>
          <div />
          <Field label="Contest starts">
            <Input type="datetime-local" required value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </Field>
          <Field label="Contest ends">
            <Input type="datetime-local" required value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create organisation'}</Button>
            <p className="mt-2 text-xs text-slate-500">The four standard task categories are added automatically. Invite its owner from the Admins page after switching into the organisation.</p>
          </div>
        </form>
      </Card>
      <Card>
        <H2>All organisations</H2>
        {loadError ? <Alert tone="error">{loadError}</Alert> : null}
        {rows === null && !loadError ? <p className="text-sm text-slate-500">Loading organisations…</p> : null}
        {rows?.length === 0 ? <p className="text-sm text-slate-500">No organisations found.</p> : null}
        <ul className="divide-y divide-slate-100">
          {rows?.map((organization) => (
            <li key={organization.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{organization.name}</span>
                <span className="text-xs text-slate-500">{organization.slug}</span>
              </span>
              {selectedId === organization.id ? <Badge>Active</Badge> : null}
              <Button type="button" variant="secondary" className="min-h-8 px-3 py-1" onClick={() => manage(organization.id)}>
                Manage contest
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
