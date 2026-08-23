/**
 * CLI argv helpers — prefer space-separated flags: `--flag value`
 * Also accept GNU long-option form `--flag=value` for compatibility.
 */

/** Value for `--name` as either `--name value` or `--name=value`. */
export function argValue(argv: readonly string[], name: string): string | undefined {
  const eqPref = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith(eqPref)) return a.slice(eqPref.length);
    if (a === `--${name}`) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) return next;
      return undefined;
    }
  }
  return undefined;
}

/** True if `--name` appears as a bare flag (not `--name=…`). */
export function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}
