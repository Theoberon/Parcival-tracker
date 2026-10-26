import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { organizationScopeFromCookie } from '../organization-scope';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      fetch: async (input, init) => {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
        const cookieHeader = store.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
        const organizationId = organizationScopeFromCookie(cookieHeader);
        if (organizationId) headers.set('x-organization-id', organizationId);
        else headers.delete('x-organization-id');
        return fetch(input, { ...init, headers });
      },
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the proxy refreshes the session cookies instead
        }
      },
    },
  });
}
