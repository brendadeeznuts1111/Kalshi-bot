/**
 * Shared CLI argv helpers (bulk SSOT for tools/* + root scripts).
 *
 *   --flag
 *   --name=value
 *   --name value
 *   --name a,b  / repeated --name (via argValues)
 */

export function hasFlag(name: string, argv: string[] = process.argv): boolean {
  return argv.includes(`--${name}`);
}

/** First value for --name=… or --name value. */
export function argValue(
  name: string,
  argv: string[] = process.argv
): string | undefined {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) {
    const next = argv[idx + 1];
    if (next && !next.startsWith('--')) return next;
  }
  return undefined;
}

/**
 * All values for a multi flag: `--event-type A --event-type B` or `--event-type A,B`.
 */
export function argValues(
  name: string,
  argv: string[] = process.argv
): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.push(...next.split(',').map(s => s.trim()).filter(Boolean));
        i++;
      }
    } else if (a.startsWith(`--${name}=`)) {
      out.push(
        ...a
          .slice(name.length + 3)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      );
    }
  }
  return out;
}
