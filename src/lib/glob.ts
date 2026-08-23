/**
 * Bun.Glob helpers - list files by pattern and test matches without npm globs.
 *
 * Bun.Glob is native in 1.4 (scan/scanSync/match); these helpers add sorted
 * listing + a predicate for the common readdir+endsWith pattern, which the
 * guard treats as a wrapper-removal target.
 *
 * @see https://bun.com/docs/api/glob (Bun.Glob)
 */

export type ListFilesOptions = {
  cwd?: string;
  onlyFiles?: boolean;
  dot?: boolean;
  /** Sort results lexicographically (default true). */
  sort?: boolean;
};

/**
 * List files under a directory matching a glob pattern (sync scan + sort).
 * Throws ENOTDIR when cwd is not a directory (Bun.Glob semantics).
 */
export function listFiles(pattern: string, opts: ListFilesOptions = {}): string[] {
  const g = new Bun.Glob(pattern);
  const out = Array.from(
    g.scanSync({ cwd: opts.cwd ?? ".", onlyFiles: opts.onlyFiles, dot: opts.dot }),
  );
  return (opts.sort ?? true) ? out.sort() : out;
}


/**
 * Async variant (scan iterator) for large trees - use when the listing is
 * big enough that the sync scan would block.
 */
export async function listFilesAsync(pattern: string, opts: ListFilesOptions = {}): Promise<string[]> {
  const g = new Bun.Glob(pattern);
  const out: string[] = [];
  for await (const p of g.scan({ cwd: opts.cwd ?? ".", onlyFiles: opts.onlyFiles, dot: opts.dot })) {
    out.push(p);
  }
  return (opts.sort ?? true) ? out.sort() : out;
}
