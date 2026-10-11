// Step 1 of a submission: the database RPC does every check (member, open, category, rate limit,
// resubmission rules, duplicate reference) and inserts the draft; we then mint a signed upload URL.
import { bearer, dbError, errorResponse, gate, json, readJson } from '../_shared/http.ts';
import type { Deps } from '../_shared/deps.ts';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;

  const token = bearer(req);
  if (!token) return errorResponse('unauthorized', 'Please log in again.', 401);
  const body = await readJson(req);
  if (!body) return errorResponse('bad_request', 'Invalid request.');
  const { category_id, reference, note, file_ext, resubmission_of } = body;
  if (typeof category_id !== 'string' || typeof reference !== 'string' || typeof file_ext !== 'string') {
    return errorResponse('bad_request', 'Category, reference and file type are required.');
  }
  if (note !== undefined && note !== null && typeof note !== 'string') return errorResponse('bad_request', 'Invalid note.');
  if (resubmission_of !== undefined && resubmission_of !== null && typeof resubmission_of !== 'string') {
    return errorResponse('bad_request', 'Invalid resubmission.');
  }

  const { data, error } = await deps.userClient(token).rpc('create_submission_draft', {
    p_category_id: category_id,
    p_reference: reference,
    p_note: note ?? null,
    p_file_ext: file_ext,
    p_resubmission_of: resubmission_of ?? null,
  });
  if (error) return dbError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.submission_id || !row?.proof_path) return errorResponse('internal', 'Something went wrong.', 500);

  const { data: signed, error: upErr } = await deps.admin().storage.from('proofs').createSignedUploadUrl(row.proof_path);
  if (upErr || !signed?.token) {
    console.error('signed upload url failed', upErr?.message);
    return errorResponse('internal', 'Could not prepare the upload. Please try again.', 500);
  }
  return json({ submission_id: row.submission_id, path: row.proof_path, token: signed.token });
}
