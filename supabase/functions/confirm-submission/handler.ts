// Step 3 of a submission (after the browser uploaded to the signed URL): verify the file really
// is there and really is an image, hash it, then let the database make the submission pending.
import { authenticate, type Deps } from '../_shared/deps.ts';
import { bearer, dbError, errorResponse, gate, json, readJson } from '../_shared/http.ts';

const MAX_BYTES = 2 * 1024 * 1024;

export function looksLikeImage(b: Uint8Array): boolean {
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return jpeg || png || webp;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req);
  if (early) return early;

  const token = bearer(req);
  const user = await authenticate(deps, token);
  if (!user || !token) return errorResponse('unauthorized', 'Please log in again.', 401);
  const body = await readJson(req);
  const submissionId = body?.submission_id;
  if (typeof submissionId !== 'string') return errorResponse('bad_request', 'submission_id is required.');

  // Own draft only: RLS on submissions limits this select to the caller's rows.
  const { data: draft, error: readErr } = await deps.userClient(token).from('submissions')
    .select('id, proof_path, status').eq('id', submissionId).maybeSingle();
  if (readErr) return dbError(readErr);
  if (!draft || draft.status !== 'draft') return errorResponse('draft_not_found', 'Draft not found or already confirmed.', 404);

  const storage = deps.admin().storage.from('proofs');
  const { data: blob, error: dlErr } = await storage.download(draft.proof_path);
  if (dlErr || !blob) return errorResponse('upload_missing', 'The screenshot has not finished uploading. Please try again.');
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length === 0 || bytes.length > MAX_BYTES || !looksLikeImage(bytes)) {
    await storage.remove([draft.proof_path]);
    return errorResponse('bad_file', 'Upload a JPG, PNG or WebP screenshot under 2 MB.');
  }
  const hash = await sha256Hex(buf);

  const { data: result, error } = await deps.admin().rpc('confirm_submission_draft', {
    p_member: user.id,
    p_id: submissionId,
    p_hash: hash,
  });
  if (error) return dbError(error);
  if (!result?.ok) {
    await storage.remove([draft.proof_path]);   // the draft row was removed by the database
    const msg = result?.error === 'resubmission_exists'
      ? 'A resubmission already exists for this item.'
      : 'This reference has already been submitted.';
    return errorResponse(result?.error ?? 'duplicate_reference', msg, 409);
  }
  return json({ ok: true });   // flags (e.g. reused_proof) are for admins only
}
