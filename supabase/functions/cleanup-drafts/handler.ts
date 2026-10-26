// Scheduled every 15 minutes (see DEPLOY.md): deletes old drafts and expired contest history.
// Only callable with the service-role key.
import type { Deps } from '../_shared/deps.ts';
import { bearer, errorResponse, gate, json } from '../_shared/http.ts';
import { purgeProofs } from '../_shared/storage.ts';

function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;
  const token = bearer(req);
  const key = deps.env('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !key || !sameSecret(token, key)) return errorResponse('forbidden', 'Not allowed.', 403);

  const admin = deps.admin();
  const cutoff = new Date(deps.now().getTime() - 60 * 60 * 1000).toISOString();
  const { data: drafts, error } = await admin.from('submissions')
    .select('id, proof_path').eq('status', 'draft').lt('created_at', cutoff).limit(500);
  if (error) {
    console.error('cleanup query failed', error.message);
    return errorResponse('internal', 'Query failed.', 500);
  }
  if (drafts?.length) {
    const { error: rmErr } = await admin.storage.from('proofs').remove(drafts.map((d: { proof_path: string }) => d.proof_path));
    if (rmErr) console.error('file removal failed', rmErr.message); // still delete rows: files are orphans, not a risk
    const { error: delErr } = await admin.from('submissions').delete().in('id', drafts.map((d: { id: string }) => d.id));
    if (delErr) {
      console.error('draft delete failed', delErr.message);
      return errorResponse('internal', 'Delete failed.', 500);
    }
  }

  const { data: expired, error: historyErr } = await admin.from('contest_history')
    .select('source_contest_id').lte('expires_at', deps.now().toISOString()).limit(100);
  if (historyErr) {
    console.error('expired history query failed', historyErr.message);
    return errorResponse('internal', 'History query failed.', 500);
  }

  let screenshotsDeleted = 0;
  const expiredIds = (expired ?? []).map((row: { source_contest_id: string }) => row.source_contest_id);
  for (const contestId of expiredIds) {
    try {
      screenshotsDeleted += await purgeProofs(deps, contestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('expired contest screenshot cleanup failed', { contest_id: contestId, error: message });
      return errorResponse('internal', 'Screenshot cleanup failed; history was retained for a retry.', 500);
    }
  }
  if (expiredIds.length) {
    const { error: purgeErr } = await admin.rpc('purge_expired_contest_history', { p_source_contest_ids: expiredIds });
    if (purgeErr) {
      console.error('expired history purge failed', purgeErr.message);
      return errorResponse('internal', 'History purge failed; a retry is scheduled.', 500);
    }
  }

  return json({ deleted: drafts?.length ?? 0, expired_contests_deleted: expiredIds.length, screenshots_deleted: screenshotsDeleted });
}
