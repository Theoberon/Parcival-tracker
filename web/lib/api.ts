'use client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/browser';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const FRIENDLY: Record<string, string> = {
  network: 'Could not reach the server. Check your connection and try again.',
  unauthorized: 'Your session has expired. Please log in again.',
  forbidden: 'You are not allowed to do that.',
  already_reviewed: 'Someone already reviewed this submission.',
  duplicate_reference: 'This reference has already been submitted.',
  rate_limited: 'Too many attempts. Please wait a while and try again.',
  submissions_closed: 'Submissions are not open right now.',
  internal: 'Something went wrong. Please try again.',
};

export function friendly(code: string, fallback?: string): string {
  return FRIENDLY[code] ?? fallback ?? FRIENDLY.internal;
}

/** Database functions raise "code: message". */
export function parseDbError(err: { message?: string } | null | undefined): { code: string; message: string } {
  const m = /^([a-z_]+): ([\s\S]*)$/.exec(err?.message ?? '');
  if (m) return { code: m[1], message: m[2] };
  return { code: 'internal', message: FRIENDLY.internal };
}

export async function callFunction<T = Record<string, unknown>>(name: string, body: unknown): Promise<ApiResult<T>> {
  const { data, error } = await supabaseBrowser().functions.invoke(name, { body: body as Record<string, unknown> });
  if (!error) return { ok: true, data: data as T };
  if (error instanceof FunctionsHttpError) {
    try {
      const j = await error.context.json();
      const code = typeof j.error === 'string' ? j.error : 'internal';
      return { ok: false, code, message: typeof j.message === 'string' ? j.message : friendly(code) };
    } catch {
      return { ok: false, code: 'internal', message: FRIENDLY.internal };
    }
  }
  return { ok: false, code: 'network', message: FRIENDLY.network };
}

/** Run an RPC and normalize the error shape. */
export async function callRpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<ApiResult<T>> {
  const { data, error } = await supabaseBrowser().rpc(fn, args);
  if (error) {
    if (error.code === 'PGRST301' || /JWT/.test(error.message)) {
      return { ok: false, code: 'unauthorized', message: FRIENDLY.unauthorized };
    }
    const e = parseDbError(error);
    return { ok: false, ...e };
  }
  return { ok: true, data: data as T };
}

export interface LoginSession { access_token: string; refresh_token: string }

/**
 * Logs in through the `login` Edge Function (which applies the growing delay after failed attempts),
 * then gives the returned session to the Supabase client. Returns an error message, or null on success.
 */
export async function loginVia(mode: 'member' | 'admin', email: string, password: string): Promise<string | null> {
  const wrong = mode === 'member' ? 'Email or key is incorrect.' : 'Email or password is incorrect.';
  const r = await callFunction<{ session: LoginSession }>('login', { email, password, mode });
  if (!r.ok) {
    // show the server's wording for delays and network limits; everything else stays generic
    if (r.code === 'locked') return r.message.replace('Email or key is incorrect.', wrong);
    if (r.code === 'rate_limited' || r.code === 'network') return r.message;
    return wrong;
  }
  const { error } = await supabaseBrowser().auth.setSession(r.data.session);
  return error ? wrong : null;
}
