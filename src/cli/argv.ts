/**
 * Shared CLI argv helpers (bulk SSOT for tools/* + root scripts), backed by
 * the Bun-recommended util.parseArgs (official guide guides-process-argv.mdx,
 * pinned bun-v1.4.0 - S207).
 *
 *   --flag
 *   --name=value
 *   --name value
 *   --name a,b  / repeated --name (via argValues)
 *
 * parseArgs needs the option SCHEMA up front, so the schema is derived from
 * the argv itself (token with '=' or a following non-flag token => string,
 * otherwise boolean). String options use multiple:true so repeated flags
 * collect; argValue takes the first, argValues flattens + comma-splits.
 */
import { parseArgs } from 'node:util';

type Parsed = { values: Record<string, unknown>; positionals: string[] };

function parse(argv: string[]): Parsed {
  const options: Record<string, { type: 'boolean' | 'string'; multiple?: boolean }> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--') || a === '--') continue;
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const next = argv[i + 1];
    if (eq >= 0 || (next && !next.startsWith('--'))) {
      options[name] = { type: 'string', multiple: true };
    } else {
      options[name] = { type: 'boolean' };
    }
  }
  const r = parseArgs({ args: argv, options, strict: false, allowPositionals: true });
  return { values: r.values as Record<string, unknown>, positionals: r.positionals };
}

export function hasFlag(name: string, argv: string[] = process.argv): boolean {
  return argv.includes('--' + name);
}

/** First value for --name=... or --name value (parseArgs-backed). */
export function argValue(
  name: string,
  argv: string[] = process.argv
): string | undefined {
  const v = parse(argv).values[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}

/**
 * All values for a multi flag: `--event-type A --event-type B` or `--event-type A,B`.
 */
export function argValues(
  name: string,
  argv: string[] = process.argv
): string[] {
  const v = parse(argv).values[name];
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((s) => String(s).split(',').map((x) => x.trim()).filter(Boolean));
}
