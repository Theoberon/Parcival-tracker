import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { organizationScopeFromCookie } from '../organization-scope';

let client: SupabaseClient | undefined;

async function scopedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  const organizationId = organizationScopeFromCookie(document.cookie);
  if (organizationId) headers.set('x-organization-id', organizationId);
  else headers.delete('x-organization-id');
  return fetch(input, { ...init, headers });
}

/** Lazily created so nothing runs during static builds. */
export function supabaseBrowser(): SupabaseClient {
  return (client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: scopedFetch } },
  ));
}
