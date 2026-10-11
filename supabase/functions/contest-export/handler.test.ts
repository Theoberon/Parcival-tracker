// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { csvCell, toCsv } from '../_shared/csv.ts';
import { fakeDeps, post } from '../_shared/fake.ts';
import { handle } from './handler.ts';

const caller = { id: 'owner-1' };

Deno.test('csv: quoting and spreadsheet-formula protection', () => {
  assertEquals(csvCell('plain'), 'plain');
  assertEquals(csvCell('a,b'), '"a,b"');
  assertEquals(csvCell('say "hi"'), '"say ""hi"""');
  assertEquals(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assertEquals(csvCell('+1'), "'+1");
  assertEquals(csvCell('-1'), "'-1");
  assertEquals(csvCell('@cmd'), "'@cmd");
  assertEquals(csvCell(null), '');
  assertEquals(csvCell({ a: 1 }), '"{""a"":1}"');
  assertEquals(toCsv(['a', 'b'], [{ a: 1, b: 'x,y' }]), 'a,b\r\n1,"x,y"\r\n');
});

function setup(o: {
  owner?: boolean;
  auditPages?: number;
  markError?: string;
  status?: string;
  archiveError?: string;
  folders?: string[];
  listError?: { prefix: string; message: string };
} = {}) {
  const listed = new Set<string>();
  return fakeDeps({
    user: {
      user: caller,
      rpc: {
        is_owner: () => ({ data: o.owner ?? true }),
        get_admin_leaderboard: () => ({ data: [{ rank: 1, display_name: '=evil', title: 'HubSpot Specialist', email: 'a@x.test', points: 7, tasks_completed: 2, reached_at: 't', pending_count: 0, active: true }] }),
        owner_mark_exported: () => (o.markError ? { error: { message: o.markError } } : { data: null }),
        get_contest_banner: () => ({ data: [{ contest_id: 'c1', status: o.status ?? 'final' }] }),
        archive_contest: () => (o.archiveError ? { error: { message: o.archiveError } } : { data: null }),
      },
      query: (q) => {
        const [from] = q.range!;
        const full = Array.from({ length: 1000 }, (_, i) => ({ id: from + i + 1, action: 'x' }));
        return { data: from / 1000 + 1 >= (o.auditPages ?? 1) ? [{ id: from + 1, action: 'last,one' }] : full };
      },
    },
    admin: {
      user: caller,
      storage: {
        list: (prefix, options) => {
          if (o.listError?.prefix === prefix) return { data: null, error: { message: o.listError.message } };
          if (prefix === 'c1') {
            const all = (o.folders ?? ['m1']).map((name) => ({ name }));
            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? all.length;
            return { data: all.slice(offset, offset + limit), error: null };
          }
          if (listed.has(prefix)) return { data: [], error: null };
          listed.add(prefix);
          return {
            data: prefix === 'c1/m1' ? [{ name: 'a.webp' }, { name: 'b.webp' }] : [{ name: 'proof.webp' }],
            error: null,
          };
        },
      },
    },
  });
}

Deno.test('owner only', async () => {
  for (const action of ['export', 'archive']) {
    const f = setup({ owner: false });
    assertEquals((await handle(post({ action }), f.deps)).status, 403);
    assert(!f.userCalls.some((c) => c.name === 'rpc:archive_contest' || c.name === 'rpc:get_admin_leaderboard'));
  }
  assertEquals((await handle(post({ action: 'export' }, null), setup().deps)).status, 401);
  assertEquals((await handle(post({ action: 'boom' }), setup().deps)).status, 400);
});

Deno.test('export: standings + full (paginated) audit log as CSV, export recorded', async () => {
  const f = setup({ auditPages: 2 });
  const res = await handle(post({ action: 'export' }), f.deps);
  const b = await res.json();
  assertEquals(b.marked, true);
  assertEquals(b.standings_csv.split('\r\n')[0], 'rank,display_name,title,email,points,tasks_completed,reached_at,pending_count,active');
  assert(b.standings_csv.includes("'=evil"), 'formula injection neutralised');
  assert(b.standings_csv.includes('HubSpot Specialist'), 'titles are exported');
  const lines = b.audit_csv.trim().split('\r\n');
  assertEquals(lines.length, 1 + 1000 + 1, 'both pages included');
  assertEquals(f.userCalls.filter((c) => c.name === 'from:audit_log:select').map((c) => c.args[1]), [[0, 999], [1000, 1999]]);
});

Deno.test('export before results are final still works but is not marked as the archive export', async () => {
  const f = setup({ markError: 'not_final: Export final results after publishing them.' });
  const res = await handle(post({ action: 'export' }), f.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).marked, false);
});

Deno.test('archive: database rules first, then screenshots are deleted', async () => {
  const f = setup();
  const res = await handle(post({ action: 'archive', reason: 'Season over' }), f.deps);
  assertEquals(await res.json(), { ok: true, files_deleted: 2 });
  assertEquals(f.userCalls.find((c) => c.name === 'rpc:archive_contest')!.args[0], { p_reason: 'Season over' });
  assertEquals(f.calls.find((c) => c.name === 'storage.remove')!.args[0], ['c1/m1/a.webp', 'c1/m1/b.webp']);
});

Deno.test('archive: storage listing failures are explicit and do not report success', async () => {
  for (const prefix of ['c1', 'c1/m1']) {
    const f = setup({ listError: { prefix, message: 'storage listing unavailable' } });
    const res = await handle(post({ action: 'archive' }), f.deps);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'archive_cleanup_failed');
    assert(!f.calls.some((c) => c.name === 'storage.remove'));
  }
});

Deno.test('archive: folder listing paginates without skipping screenshot folders', async () => {
  const folders = Array.from({ length: 101 }, (_, i) => `member-${i}`);
  const f = setup({ folders });
  const res = await handle(post({ action: 'archive' }), f.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).files_deleted, folders.length);
  const rootPages = f.calls.filter((c) => c.name === 'storage.list' && c.args[0] === 'c1');
  assertEquals(rootPages.map((c) => c.args[1].offset), [0, 100]);
});

Deno.test('archive: refused by the database -> nothing is deleted', async () => {
  for (const archiveError of ['too_early: Archiving is allowed 30 days after results were published.', 'not_exported: Export the final results before archiving.']) {
    const f = setup({ archiveError });
    const res = await handle(post({ action: 'archive', reason: 'x' }), f.deps);
    assertEquals(res.status, 400);
    assert(!f.calls.some((c) => c.name === 'storage.remove'));
  }
});

Deno.test('archive: safe to re-run after a partial failure (already archived -> only purge)', async () => {
  const f = setup({ status: 'archived' });
  const res = await handle(post({ action: 'archive', reason: 'x' }), f.deps);
  assertEquals(res.status, 200);
  assert(!f.userCalls.some((c) => c.name === 'rpc:archive_contest'));
  assert(f.calls.some((c) => c.name === 'storage.remove'));
});
