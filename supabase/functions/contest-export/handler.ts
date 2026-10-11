// Owner only: final-standings + audit-log CSVs, and the archive step that deletes screenshots.
// The database enforces the rules (final, 30 days, exported first); we only add the file deletion.
import { authenticate, type Deps } from '../_shared/deps.ts';
import { toCsv } from '../_shared/csv.ts';
import { bearer, dbError, errorResponse, gate, json, readJson } from '../_shared/http.ts';

const PAGE = 1000;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;

  const token = bearer(req);
  const caller = await authenticate(deps, token);
  if (!caller || !token) return errorResponse('unauthorized', 'Please log in again.', 401);
  const body = await readJson(req);
  const action = body?.action;
  if (action !== 'export' && action !== 'archive') return errorResponse('bad_request', 'action must be export or archive.');

  const user = deps.userClient(token);
  const { data: isOwner, error: roleErr } = await user.rpc('is_owner');
  if (roleErr) return dbError(roleErr);
  if (isOwner !== true) return errorResponse('forbidden', 'Not allowed.', 403);

  return action === 'export' ? await exportCsvs(user) : await archive(user, deps, body?.reason);
}

// deno-lint-ignore no-explicit-any
async function exportCsvs(user: any): Promise<Response> {
  const { data: standings, error } = await user.rpc('get_admin_leaderboard');
  if (error) return dbError(error);

  const audit: Record<string, unknown>[] = [];
  for (let from = 0;; from += PAGE) {
    const { data, error: aErr } = await user.from('audit_log').select('*').order('id').range(from, from + PAGE - 1);
    if (aErr) return dbError(aErr);
    audit.push(...data);
    if (data.length < PAGE) break;
  }

  // Marks the export (required before archiving). Only possible once results are final.
  const { error: markErr } = await user.rpc('owner_mark_exported');
  const marked = !markErr;
  if (markErr && !/^not_final:/.test(markErr.message)) return dbError(markErr);

  return json({
    marked,
    standings_csv: toCsv(
      ['rank', 'display_name', 'title', 'email', 'points', 'tasks_completed', 'reached_at', 'pending_count', 'active'],
      standings,
    ),
    audit_csv: toCsv(
      ['id', 'created_at', 'contest_id', 'actor_type', 'actor_id', 'action', 'entity', 'entity_id', 'reason', 'before', 'after'],
      audit,
    ),
  });
}

// deno-lint-ignore no-explicit-any
async function archive(user: any, deps: Deps, reason: unknown): Promise<Response> {
  const { data: banner, error } = await user.rpc('get_contest_banner');
  if (error) return dbError(error);
  const contest = Array.isArray(banner) ? banner[0] : banner;
  if (!contest) return errorResponse('not_found', 'Contest not found.', 404);

  // Re-running after a partial failure only needs the file purge.
  if (contest.status !== 'archived') {
    const { error: aErr } = await user.rpc('archive_contest', { p_reason: typeof reason === 'string' ? reason : '' });
    if (aErr) return dbError(aErr);
  }
  try {
    const removed = await purgeProofs(deps, contest.contest_id);
    return json({ ok: true, files_deleted: removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('contest-export: screenshot purge failed', {
      contest_id: contest.contest_id,
      error: message,
    });
    return errorResponse(
      'archive_cleanup_failed',
      'The contest was archived, but screenshot cleanup failed. Retry the archive action to continue cleanup.',
      500,
    );
  }
}

/** Deletes every object under "{contest_id}/" in the proofs bucket (member folders, then files). */
async function purgeProofs(deps: Deps, contestId: string): Promise<number> {
  const bucket = deps.admin().storage.from('proofs');
  let removed = 0;
  const folders: { name: string }[] = [];
  for (let offset = 0;;) {
    const { data, error } = await bucket.list(contestId, { limit: 100, offset });
    if (error) throw new Error(`Storage folder listing failed at offset ${offset}: ${error.message}`);
    if (!data) throw new Error(`Storage folder listing returned no data at offset ${offset}.`);
    folders.push(...data);
    if (data.length < 100) break;
    offset += data.length;
  }

  for (const folder of folders) {
    const prefix = `${contestId}/${folder.name}`;
    for (;;) {
      const { data: files, error: listError } = await bucket.list(prefix, { limit: 100, offset: 0 });
      if (listError) throw new Error(`Storage file listing failed for "${prefix}": ${listError.message}`);
      if (!files) throw new Error(`Storage file listing returned no data for "${prefix}".`);
      if (!files.length) break;
      const { data: deleted, error: removeError } = await bucket.remove(
        files.map((file: { name: string }) => `${prefix}/${file.name}`),
      );
      if (removeError) throw new Error(`Storage file removal failed for "${prefix}": ${removeError.message}`);
      if (!deleted?.length) throw new Error(`Storage file removal made no progress for "${prefix}".`);
      removed += deleted.length;
    }
  }
  return removed;
}
