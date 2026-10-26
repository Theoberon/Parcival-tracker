// Test helpers: a fake Supabase client + Deps. Not used at runtime.
// deno-lint-ignore-file no-explicit-any
import type { Deps } from './deps.ts';

type Result = { data?: any; error?: { message: string; code?: string } | null };
export interface Query { table: string; action: string; filters: [string, string, unknown][]; range?: [number, number] }

class Builder {
  filters: [string, string, unknown][] = [];
  action = 'select';
  rangeArg?: [number, number];
  single = false;
  constructor(private table: string, private onQuery: (q: Query) => Result | Promise<Result>) {}
  select() { return this; }
  delete() { this.action = 'delete'; return this; }
  eq(c: string, v: unknown) { this.filters.push([c, 'eq', v]); return this; }
  lt(c: string, v: unknown) { this.filters.push([c, 'lt', v]); return this; }
  lte(c: string, v: unknown) { this.filters.push([c, 'lte', v]); return this; }
  in(c: string, v: unknown) { this.filters.push([c, 'in', v]); return this; }
  order() { return this; }
  limit() { return this; }
  range(a: number, b: number) { this.rangeArg = [a, b]; return this; }
  maybeSingle() { this.single = true; return this.exec(); }
  private async exec() {
    const r = await this.onQuery({ table: this.table, action: this.action, filters: this.filters, range: this.rangeArg });
    const data = this.single ? (Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null) : r.data ?? null;
    return { data, error: r.error ?? null };
  }
  // deno-lint-ignore no-thenable
  then(res: (v: any) => unknown, rej?: (e: unknown) => unknown) { return this.exec().then(res, rej); }
}

export interface FakeOpts {
  rpc?: Record<string, (args: any) => Result | Promise<Result>>;
  query?: (q: Query) => Result | Promise<Result>;
  storage?: {
    createSignedUploadUrl?: (path: string) => Result;
    download?: (path: string) => Result;
    remove?: (paths: string[]) => Result;
    list?: (prefix: string, options?: { limit?: number; offset?: number }) => Result;
  };
  user?: { id: string; email?: string } | null;
  signIn?: (creds: { email: string; password: string }) => { session?: { access_token: string; refresh_token: string }; error?: { message: string; status?: number } };
  authAdmin?: {
    inviteUserByEmail?: (email: string, opts: any) => Result;
    updateUserById?: (id: string, attrs: any) => Result;
    deleteUser?: (id: string) => Result;
    resetPasswordForEmail?: (email: string, opts: any) => Result;
  };
}

export function fakeClient(opts: FakeOpts, calls: { name: string; args: any[] }[]) {
  const log = (name: string, ...args: any[]) => calls.push({ name, args });
  return {
    rpc: async (name: string, args?: any) => {
      log(`rpc:${name}`, args);
      const h = opts.rpc?.[name];
      const r = h ? await h(args) : { data: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
    from: (table: string) => new Builder(table, (q) => { log(`from:${table}:${q.action}`, q.filters, q.range); return opts.query?.(q) ?? { data: [] }; }),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (p: string) => { log('storage.createSignedUploadUrl', bucket, p); return opts.storage?.createSignedUploadUrl?.(p) ?? { data: { token: 'tok', path: p } }; },
        download: async (p: string) => { log('storage.download', p); return opts.storage?.download?.(p) ?? { data: null, error: { message: 'not found' } }; },
        remove: async (ps: string[]) => {
          log('storage.remove', ps);
          return opts.storage?.remove?.(ps) ?? {
            data: ps.map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1) })),
            error: null,
          };
        },
        list: async (prefix: string, options?: { limit?: number; offset?: number }) => {
          log('storage.list', prefix, options);
          return opts.storage?.list?.(prefix, options) ?? { data: [], error: null };
        },
      }),
    },
    auth: {
      signInWithPassword: async (c: { email: string; password: string }) => {
        log('auth.signInWithPassword', c);
        const r = opts.signIn?.(c) ?? { error: { message: 'Invalid login credentials', status: 400 } };
        return r.error ? { data: { session: null, user: null }, error: r.error } : { data: { session: r.session, user: { id: 'u1' } }, error: null };
      },
      getUser: async (token: string) => {
        log('auth.getUser', token);
        return opts.user ? { data: { user: opts.user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
      resetPasswordForEmail: async (email: string, o: any) => { log('auth.resetPasswordForEmail', email, o); const r = opts.authAdmin?.resetPasswordForEmail?.(email, o) ?? {}; return { data: null, error: r.error ?? null }; },
      admin: {
        inviteUserByEmail: async (email: string, o: any) => { log('auth.admin.inviteUserByEmail', email, o); const r = opts.authAdmin?.inviteUserByEmail?.(email, o) ?? { data: { user: { id: '11111111-1111-4111-8111-111111111111' } } }; return { data: r.data ?? null, error: r.error ?? null }; },
        updateUserById: async (id: string, a: any) => { log('auth.admin.updateUserById', id, a); const r = opts.authAdmin?.updateUserById?.(id, a) ?? {}; return { data: null, error: r.error ?? null }; },
        deleteUser: async (id: string) => { log('auth.admin.deleteUser', id); return { data: null, error: null }; },
      },
    },
  };
}

export function fakeDeps(opts: { user?: FakeOpts; admin?: FakeOpts; anon?: FakeOpts; env?: Record<string, string>; fetch?: typeof fetch; now?: Date } = {}) {
  const calls: { name: string; args: any[] }[] = [];
  const userCalls: { name: string; args: any[] }[] = [];
  const background: Promise<unknown>[] = [];
  const env: Record<string, string> = { SITE_URL: 'https://contest.example.com', ...opts.env };
  const deps: Deps = {
    env: (n) => env[n],
    userClient: (token, organizationId) => { userCalls.push({ name: 'userClient', args: [token, organizationId] }); return fakeClient({ ...opts.user }, userCalls) as any; },
    admin: () => fakeClient({ user: opts.user?.user, ...opts.admin }, calls) as any,
    anon: () => fakeClient({ ...opts.anon }, calls) as any,
    fetch: opts.fetch ?? (() => Promise.reject(new Error('unexpected fetch'))),
    background: (p) => { background.push(p); },
    now: () => opts.now ?? new Date('2026-10-20T12:00:00Z'),
  };
  return { deps, calls, userCalls, flush: () => Promise.all(background) };
}

export function post(body: unknown, token: string | null = 'user-jwt', extra: Record<string, string> = {}): Request {
  return new Request('https://x.test/fn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
