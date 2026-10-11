// Public "Resend my key". Always answers with the same message so nobody can probe which emails
// are registered. Rate limited per email and per IP in the database.
import type { Deps } from '../_shared/deps.ts';
import { errorResponse, gate, json, readJson } from '../_shared/http.ts';

export const GENERIC_MESSAGE = 'If this email is registered, a new key has been sent.';

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('cf-connecting-ip') || null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;

  const body = await readJson(req);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return errorResponse('invalid_email', 'Enter a valid email address.');
  }
  const ip = clientIp(req);

  // Do the work after replying, so response time never reveals whether the email is registered.
  deps.background(forwardToAppsScript(deps, email, ip));
  return json({ message: GENERIC_MESSAGE });
}

async function forwardToAppsScript(deps: Deps, email: string, ip: string | null): Promise<void> {
  const admin = deps.admin();
  const { data: allowed, error } = await admin.rpc('rate_limit_key_request', { p_email: email, p_ip: ip });
  if (error || allowed !== true) return;

  const { data: member } = await admin.from('members').select('id').eq('email', email).eq('active', true).maybeSingle();
  if (!member) return;

  const url = deps.env('APPS_SCRIPT_URL');
  const secret = deps.env('RESEND_SHARED_SECRET');
  if (!url || !secret) {
    console.error('APPS_SCRIPT_URL / RESEND_SHARED_SECRET are not configured');
    return;
  }
  // Apps Script cannot read headers, so the shared secret goes in the (HTTPS) JSON body.
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, email }),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok || text.trim() !== 'ok') console.error('apps script resend failed', res.status, text.slice(0, 80));
}
