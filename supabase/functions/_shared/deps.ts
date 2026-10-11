// Dependency container so handlers can be unit-tested with fakes.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface Deps {
  env: (name: string) => string | undefined;
  /** Client acting as the logged-in user (RLS applies, auth.uid() is set). */
  userClient: (token: string) => SupabaseClient;
  /** Client with only the public anon key (for verifying a password like the browser would). */
  anon: () => SupabaseClient;
  /** Service-role client. Only for work the user must not do themselves (storage, auth admin). */
  admin: () => SupabaseClient;
  fetch: typeof fetch;
  /** Run work after the response is sent (EdgeRuntime.waitUntil); awaited inline if unavailable. */
  background: (work: Promise<unknown>) => void;
  now: () => Date;
}

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing function secret: ${name}`);
  return v;
}

export function realDeps(): Deps {
  let admin: SupabaseClient | undefined;
  return {
    env: (n) => Deno.env.get(n),
    userClient: (token) =>
      createClient(need('SUPABASE_URL'), need('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    anon: () =>
      createClient(need('SUPABASE_URL'), need('SUPABASE_ANON_KEY'), {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    admin: () =>
      (admin ??= createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { persistSession: false, autoRefreshToken: false },
      })),
    fetch: (...a) => fetch(...a),
    background: (work) => {
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      const guarded = work.catch((e) => console.error('background task failed', e instanceof Error ? e.message : e));
      if (rt?.waitUntil) rt.waitUntil(guarded);
    },
    now: () => new Date(),
  };
}

/** Verifies the bearer token with Supabase Auth and returns the user id. */
export async function authenticate(deps: Deps, token: string | null): Promise<{ id: string; email?: string } | null> {
  if (!token) return null;
  const { data, error } = await deps.admin().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
