// Small HTTP helpers shared by all Edge Functions.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Handles CORS preflight and non-POST methods. Returns a Response when the request is done. */
export function gate(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Use POST.' }, 405);
  return null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  forbidden: 403, not_member: 403, not_found: 404, draft_not_found: 404,
  already_reviewed: 409, duplicate_reference: 409, resubmission_exists: 409, rate_limited: 429,
};

/**
 * Database errors are raised as "code: human message" (see the migrations). Known codes are passed
 * to the client; anything else is hidden behind a generic message.
 */
export function dbError(error: { message?: string; code?: string; status?: number }): Response {
  const msg = error.message ?? '';
  if (error.code === 'PGRST301' || error.code === 'PGRST303' || /\bJWT\b/.test(msg)) {
    return json({ error: 'unauthorized', message: 'Please log in again.' }, 401);
  }
  const m = /^([a-z_]+): ([\s\S]*)$/.exec(msg);
  if (m) return json({ error: m[1], message: m[2] }, STATUS_BY_CODE[m[1]] ?? 400);
  if (error.code === '42501') return json({ error: 'forbidden', message: 'Not allowed.' }, 403);
  console.error('unexpected database error', error.code, msg);
  return json({ error: 'internal', message: 'Something went wrong. Please try again.' }, 500);
}

export function errorResponse(code: string, message: string, status = 400): Response {
  return json({ error: code, message }, status);
}
