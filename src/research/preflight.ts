// @see https://bun.com/docs/runtime/utils#bun-which
/** Preflight: gh must be on PATH before any research run. */
export function ensureGh(): string {
  const path = Bun.which("gh");
  if (!path) {
    throw new Error(
      "gh CLI not found on PATH. Install https://cli.github.com and run `gh auth login`.",
    );
  }
  return path;
}
