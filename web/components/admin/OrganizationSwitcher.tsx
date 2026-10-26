'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { setOrganizationScope } from '@/lib/organization-scope';
import { Select } from '@/components/ui';

type Organization = { id: string; name: string };

export default function OrganizationSwitcher({ selectedId }: { selectedId: string | null }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void supabaseBrowser().from('organizations').select('id,name').order('name').then(({ data, error: queryError }) => {
      if (!live) return;
      if (queryError) setError('Could not load organisations.');
      else setOrganizations((data as Organization[]) ?? []);
    });
    return () => { live = false; };
  }, []);

  function changeOrganization(id: string) {
    setOrganizationScope(id || null);
    router.push(id ? '/admin/contest' : '/admin/organizations');
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <span className="sr-only">Active organisation</span>
      <Select
        aria-label="Active organisation"
        value={selectedId ?? ''}
        onChange={(event) => changeOrganization(event.target.value)}
        className="max-w-56 py-1 text-xs"
      >
        <option value="">Select organisation…</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>{organization.name}</option>
        ))}
      </Select>
      {error ? <span role="alert" className="text-red-700">{error}</span> : null}
    </label>
  );
}
