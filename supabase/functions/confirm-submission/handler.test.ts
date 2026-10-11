// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { fakeDeps, post } from '../_shared/fake.ts';
import { handle, looksLikeImage, sha256Hex } from './handler.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const user = { id: 'member-1' };
const draftRow = { data: [{ id: 's1', proof_path: 'c/member-1/s1.jpg', status: 'draft' }] };

function setup(over: { file?: Uint8Array | null; confirm?: any; draft?: any; rpcError?: any } = {}) {
  const file = over.file === undefined ? JPEG : over.file;
  return fakeDeps({
    user: { user, query: () => over.draft ?? draftRow },
    admin: {
      user,
      storage: { download: () => (file ? { data: new Blob([file as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }) },
      rpc: { confirm_submission_draft: () => (over.rpcError ? { error: over.rpcError } : { data: over.confirm ?? { ok: true, flags: ['reused_proof'] } }) },
    },
  });
}

Deno.test('success: hashes the stored file, confirms as the member, hides flags', async () => {
  const f = setup();
  const res = await handle(post({ submission_id: 's1' }), f.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  const rpc = f.calls.find((c) => c.name === 'rpc:confirm_submission_draft')!;
  assertEquals(rpc.args[0], { p_member: 'member-1', p_id: 's1', p_hash: await sha256Hex(JPEG.buffer as ArrayBuffer) });
  assertEquals(rpc.args[0].p_hash.length, 64);
});

Deno.test('the member id comes from the verified token, never from the request body', async () => {
  const f = setup();
  await handle(post({ submission_id: 's1', member_id: 'someone-else', p_member: 'someone-else' }), f.deps);
  assertEquals(f.calls.find((c) => c.name === 'rpc:confirm_submission_draft')!.args[0].p_member, 'member-1');
});

Deno.test('screenshot not uploaded yet -> upload_missing', async () => {
  const res = await handle(post({ submission_id: 's1' }), setup({ file: null }).deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'upload_missing');
});

Deno.test('not an image / too large -> rejected and file removed', async () => {
  for (const file of [new TextEncoder().encode('<html>not an image</html>'), new Uint8Array(0), (() => { const b = new Uint8Array(2 * 1024 * 1024 + 1); b.set(JPEG); return b; })()]) {
    const f = setup({ file });
    const res = await handle(post({ submission_id: 's1' }), f.deps);
    assertEquals((await res.json()).error, 'bad_file');
    assert(f.calls.some((c) => c.name === 'storage.remove'));
    assert(!f.calls.some((c) => c.name === 'rpc:confirm_submission_draft'));
  }
});

Deno.test('duplicate reference at confirm time -> 409 and the file is deleted', async () => {
  const f = setup({ confirm: { ok: false, error: 'duplicate_reference' } });
  const res = await handle(post({ submission_id: 's1' }), f.deps);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).message, 'This reference has already been submitted.');
  assertEquals(f.calls.find((c) => c.name === 'storage.remove')!.args[0], ['c/member-1/s1.jpg']);
});

Deno.test('not your draft / already confirmed -> 404, nothing downloaded', async () => {
  for (const draft of [{ data: [] }, { data: [{ id: 's1', proof_path: 'p', status: 'pending' }] }]) {
    const f = setup({ draft });
    const res = await handle(post({ submission_id: 's1' }), f.deps);
    assertEquals(res.status, 404);
    assert(!f.calls.some((c) => c.name === 'storage.download'));
  }
});

Deno.test('closed contest error from the database is surfaced', async () => {
  const res = await handle(post({ submission_id: 's1' }), setup({ rpcError: { message: 'submissions_closed: Submissions are closed.' } }).deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'submissions_closed');
});

Deno.test('unauthenticated / bad body', async () => {
  const noUser = fakeDeps();
  assertEquals((await handle(post({ submission_id: 's1' }), noUser.deps)).status, 401);
  assertEquals((await handle(post({ submission_id: 's1' }, null), noUser.deps)).status, 401);
  assertEquals((await handle(post({}), setup().deps)).status, 400);
});

Deno.test('magic-byte check', () => {
  assert(looksLikeImage(JPEG));
  assert(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])));
  assert(looksLikeImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])));
  assert(!looksLikeImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0])));
});
