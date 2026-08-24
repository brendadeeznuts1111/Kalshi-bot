/**
 * plugin-namespaces.ts — typed registry for Bun bundler plugin namespaces
 * (probe-verified, AGENT-PITFALLS §61).
 *
 * The only RUNTIME-ENFORCED fact about plugin namespaces is the charset:
 * Bun 1.4.0 rejects any namespace outside [$a-zA-Z0-9_-] with
 * "TypeError: namespace can only contain $a-zA-Z0-9_\-". Every other
 * namespace fact is probe-derived and recorded here as data so the
 * probes, docs (§61), and /bun/plugins page share ONE source of truth.
 *
 * Probe-verified facts encoded below:
 *   - default namespace is "file" (relative imports; onResolve scoped to
 *     namespace "file" fires; a plugin can redirect a file: specifier)
 *   - the doc namespace: "yaml:" example THROWS (colon invalid)
 *   - "env" virtual-module pattern works in Bun.build
 *   - node:/bun: modules resolve with ns "file", NOT "node"/"bun" —
 *     the doc "common namespaces" list is WRONG (probe §61)
 *   - runtime onResolve/onLoad never fire; only build.module() works
 *
 * @see docs/AGENT-PITFALLS.md §61
 * @see src/research/plugins-page.ts (/bun/plugins)
 */

/** Charset Bun accepts for namespace strings (error text, probed §61). */
export const PLUGIN_NAMESPACE_CHARSET = /^[a-zA-Z0-9_$-]+$/;

/** Branded plugin namespace — any charset-valid string, not a closed union. */
export type PluginNamespace = string & { readonly __brand: unique symbol };

export function asPluginNamespace(raw: string): PluginNamespace {
  if (!PLUGIN_NAMESPACE_CHARSET.test(raw)) {
    throw new Error("PluginNamespace: invalid charset [" + raw + "] — must match " + PLUGIN_NAMESPACE_CHARSET.source);
  }
  return raw as PluginNamespace;
}

export function tryPluginNamespace(raw: string | undefined | null): PluginNamespace | undefined {
  if (!raw) return undefined;
  try { return asPluginNamespace(raw); } catch { return undefined; }
}

export function parsePluginNamespace(raw: unknown): PluginNamespace {
  if (typeof raw !== "string") throw new Error("PluginNamespace: expected string");
  return asPluginNamespace(raw);
}

/** Every module starts in this namespace unless a plugin moves it. */
export const DEFAULT_PLUGIN_NAMESPACE = asPluginNamespace("file");

/**
 * Known namespaces used by probes/tests, with the probe note. The doc
 * "node"/"bun" namespaces are deliberately ABSENT — §61 proved node:fs
 * resolves with ns "file" and onResolve({namespace:"node"}) never fires.
 */
export const KNOWN_PLUGIN_NAMESPACES = {
  file: { ns: DEFAULT_PLUGIN_NAMESPACE, probe: "default — relative imports; plugin can redirect file: specifier (verified §61)", example: 'build.onLoad({ filter: /\.txt$/, namespace: "file" }, ...)' },
  env: { ns: asPluginNamespace("env"), probe: "virtual env-module pattern works in Bun.build (verified §61)", example: 'build.onLoad({ filter: /.*/, namespace: "env" }, ...) — the doc env plugin' },
  yaml: { ns: asPluginNamespace("yaml"), probe: "valid alphanumeric ns; the doc yaml: (colon) THROWS (verified §61)", example: 'build.onResolve({ filter: /\.yaml$/, namespace: "file" }, () => ({ path, namespace: "yaml" }))' },
  virt: { ns: asPluginNamespace("virt"), probe: "build.module() runtime virtual module (verified §61)", example: 'build.module("hello:world", () => ({ exports: { foo: "bar" }, loader: "object" }))' },
  stats: { ns: asPluginNamespace("stats"), probe: "defer() example namespace (verified §61)", example: 'build.onLoad({ filter: /stats\.json/, namespace: "stats" }, async ({ defer }) => ...)' },
} as const;

export type KnownPluginNamespace = keyof typeof KNOWN_PLUGIN_NAMESPACES;

/**
 * Namespace strings that MUST be rejected — probed against the runtime
 * (asPluginNamespace throws for exactly these; yaml: / file: are the doc
 * own examples). UPPER_CASE is VALID (charset includes A-Z).
 */
export const INVALID_PLUGIN_NAMESPACES = [
  "yaml:", // doc example — colon invalid (§61)
  "file:", // doc claim — colon invalid; file: is internal-only (§61)
  "with spaces",
  "a:b:c",
] as const;

/**
 * Empty-string namespace: NOT invalid — probed §61 follow-up. The runtime
 * treats namespace:"" as NO CONSTRAINT (the callback fires for
 * file-namespace modules; identical to omitting the field). asPluginNamespace
 * still rejects it because a *named* namespace must be charset-valid — use
 * undefined / omit for the unconstrained case, never the empty string.
 */
export const EMPTY_PLUGIN_NAMESPACE_NOTE = "empty string = unconstrained (runtime accepts; matches any namespace) — omit the field instead (probed §61)";

/** Documentation map — rendered by the /bun/plugins page and §61. */
export const PLUGIN_NAMESPACE_DOCS = {
  file: "default filesystem namespace — relative imports, node:/bun: built-ins (ns file, NOT node/bun) (§61)",
  env: "virtual module pattern — onResolve to namespace + onLoad contents (verified in Bun.build)",
  yaml: "valid alphanumeric namespace — the doc yaml: (colon) throws",
  virt: "runtime virtual module via build.module(specifier, cb) — the ONLY runtime path (§61)",
  stats: "defer() example namespace — waits for all other modules",
} as const;

/** True when the runtime charset accepts the string (mirrors asPluginNamespace). */
export function isValidPluginNamespace(value: string): value is PluginNamespace {
  return PLUGIN_NAMESPACE_CHARSET.test(value);
}