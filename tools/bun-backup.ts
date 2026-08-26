/**
 * `bun run bun:backup` — archive research DBs + caches with Bun.Archive
 * (v1.4 native tar; replaces the tar npm package - deps-audit table).
 *
 * What: tars the named research/cache files (default: the *.db set) into
 * research/backups/research-<YYYYMMDD-HHMMSS>.tar, streaming from disk.
 *
 * Why: the event-store.db is ~88MB of irreplaceable market data; the
 * paste's 'Bun.Archive for backups' roadmap item, made concrete.
 *
 * Flags:
 *   --keep=N    keep the N newest backups, delete older (default 5).
 *   --list      list existing backups.
 *
 * @see docs/AGENT-PITFALLS.md section 21 (Archive was the open item)
 */
import { readdirSync, existsSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { parseArgs } from 'node:util';

assertBunAtLeast('1.4.0', 'bun:backup');

const ROOT = join(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, 'research/cache');
const BACKUP_DIR = join(ROOT, 'research/backups');

/** Default backup set: the SQLite DBs + small caches (skip logs/locks). */
function defaultBackupFiles(): string[] {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith('.db') || f.endsWith('.json') || f.endsWith('.mdx'))
    .filter((f) => !f.endsWith('-shm') && !f.endsWith('-wal'))
    .map((f) => join(CACHE_DIR, f));
}

const { values: bbv, positionals: bbp } = parseArgs({ args: Bun.argv.slice(2), options: { list: { type: 'boolean' }, keep: { type: 'string' } }, strict: false, allowPositionals: true });
function argValue(name: string): number | undefined {
  const v = bbv[name];
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function listBackups(): Promise<void> {
  if (!existsSync(BACKUP_DIR)) { console.log('no backups yet (' + BACKUP_DIR + ')'); return; }
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.tar')).sort();
  if (!files.length) { console.log('no backups yet (' + BACKUP_DIR + ')'); return; }
  for (const f of files) {
    const size = statSync(join(BACKUP_DIR, f)).size;
    console.log('  ' + f + '  (' + (size / 1048576).toFixed(1) + ' MB)');
  }
}

async function main(): Promise<number> {
  if (bbv.list === true) {
    await listBackups();
    return 0;
  }
  const keep = argValue('keep') ?? 5;
  const files = defaultBackupFiles();
  if (!files.length) {
    console.error('no backup-able files in ' + CACHE_DIR);
    return 1;
  }
  const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = join(BACKUP_DIR, 'research-' + stamp + '.tar');
  mkdirSync(BACKUP_DIR, { recursive: true });

  // Docs-canonical Archive path (grounded against runtime/archive.mdx):
  // `new Bun.Archive({...})` then `Bun.write(path, archive)`. Accepted
  // value types per docs: strings, Blobs, ArrayBufferViews, ArrayBuffers.
  // BunFile is NOT in that list - passing one archives a 0-byte entry
  // (probe-verified; the earlier '0-byte bug' is actually documented
  // behavior for an undocumented input type). .bytes() is the valid way;
  // the 88MB event-store loads into memory - acceptable for backups.
  const entries: Record<string, BlobPart> = {};
  for (const f of files) {
    entries['cache/' + f.split('/').pop()!] = await Bun.file(f).bytes();
  }
  const archive = new Bun.Archive(entries as unknown as Bun.ArchiveInput);
  await Bun.write(outPath, archive);
  const size = statSync(outPath).size;
  console.log('backup: ' + outPath);
  console.log('  ' + files.length + ' files, ' + (totalBytes / 1048576).toFixed(1) + ' MB raw -> ' + (size / 1048576).toFixed(1) + ' MB tar');

  // Prune: keep the newest N tars.
  const tars = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.tar')).sort();
  const stale = tars.slice(0, Math.max(0, tars.length - keep));
  for (const f of stale) unlinkSync(join(BACKUP_DIR, f));
  if (stale.length) console.log('  pruned ' + stale.length + ' old backup(s) (keep=' + keep + ')');
  return 0;
}

process.exit(await main());