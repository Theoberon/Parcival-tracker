import type { Deps } from './deps.ts';

/** Deletes every object under "{contestId}/" in the proofs bucket. */
export async function purgeProofs(deps: Deps, contestId: string): Promise<number> {
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
