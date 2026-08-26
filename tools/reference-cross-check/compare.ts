#!/usr/bin/env bun
/**
 * Ledger + comparison engine for the reference cross-check (178).
 *
 * Every ledger claim pins: (a) the official bun-types text (fragment in a
 * bundle-relative source file) and (b) the observed value in
 * tools/build-artifact-evidence.json (dotted evidencePath). The verdict
 * classifies doc-vs-runtime agreement:
 *   CONSISTENT        - fragment present AND observed value exists
 *   PINNED-DISCREPANCY- fragment present, doc and observation deliberately
 *                       disagree (our correction; non-fatal)
 *   DOC-CHANGED       - fragment NOT found in the pinned docs (fatal: the
 *                       pin's premise moved - re-verify)
 *   NO-EVIDENCE       - evidencePath does not resolve (fatal: ledger bug)
 */
import type { Evidence } from './evidence-loader.ts';
import { resolvePath } from './evidence-loader.ts';

export type LedgerKind = 'consistent' | 'discrepancy';

export interface LedgerClaim {
  id: string;
  api: string;
  source: string; // path relative to the bundle root (e.g. 'bun.d.ts', 'docs/bundler/index.mdx')
  fragment: string; // distinctive text that must be present in source
  docSays: string;
  evidencePath: string;
  kind: LedgerKind;
}

export type Verdict = 'CONSISTENT' | 'PINNED-DISCREPANCY' | 'DOC-CHANGED' | 'NO-EVIDENCE';

export interface CheckResult {
  claim: LedgerClaim;
  verdict: Verdict;
  docFound: boolean;
  observed: unknown;
}

export const LEDGER: LedgerClaim[] = [
  // ---- BuildArtifact surface (findings 1) ----
  { id: 'BA-extendsBlob', api: 'kind', source: 'docs/bundler/index.mdx', fragment: 'interface BuildArtifact extends Blob', docSays: 'BuildArtifact extends Blob (Blob methods incl. .bytes()/.image() would apply)', evidencePath: 'surface.methods.instanceofBlob', kind: 'discrepancy' },
  { id: 'BA-kinds', api: 'kind', source: 'bun.d.ts', fragment: 'kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode"', docSays: 'kind is one of five output roles', evidencePath: 'scenarios.S03-splitting.observed.kinds', kind: 'consistent' },
  { id: 'BA-hash', api: 'hash', source: 'bun.d.ts', fragment: 'hash: string | null', docSays: 'hash is string | null', evidencePath: 'scenarios.S04-sourcemap-linked.outputs[1].hash', kind: 'consistent' },

  // ---- BuildConfig options (findings 2) ----
  { id: 'BC-outfile', api: 'outfile', source: 'bun.d.ts', fragment: 'outfile?: string', docSays: 'outfile: single output file path', evidencePath: 'scenarios.S19-outfile.observed.writtenAtOutfilePath', kind: 'discrepancy' },
  { id: 'BC-env', api: 'env', source: 'bun.d.ts', fragment: 'Controls how environment variables are handled during bundling', docSays: 'env: "inline" injects env values into the output', evidencePath: 'scenarios.S12-env-inline.observed.substituted', kind: 'discrepancy' },
  { id: 'BC-allowUnresolved', api: 'allowUnresolved', source: 'bun.d.ts', fragment: 'Control whether dynamic', docSays: 'allowUnresolved: glob allow-lists pass dynamic import() through', evidencePath: 'scenarios.S14-allowUnresolved-glob.ok', kind: 'discrepancy' },
  { id: 'BC-bytecode', api: 'bytecode', source: 'bun.d.ts', fragment: 'Generate bytecode for the output', docSays: 'bytecode: true emits bytecode', evidencePath: 'scenarios.S06-bytecode.observed.kinds', kind: 'consistent' },
  { id: 'BC-compile', api: 'compile', source: 'bun.d.ts', fragment: 'compile?: boolean | Bun.Build.CompileTarget | CompileBuildOptions', docSays: 'compile: standalone executable', evidencePath: 'scenarios.S07a-compile-outdir.observed.written', kind: 'consistent' },
  { id: 'BC-define', api: 'define', source: 'bun.d.ts', fragment: 'define?: Record<string, string>', docSays: 'define: replace expressions with constants', evidencePath: 'scenarios.S11-define.observed.inlined', kind: 'consistent' },
  { id: 'BC-drop', api: 'drop', source: 'bun.d.ts', fragment: 'Drop function calls to matching property accesses', docSays: 'drop: remove matching calls', evidencePath: 'scenarios.S13b-drop-on.observed.hasConsoleLog', kind: 'consistent' },
  { id: 'BC-sourcemap', api: 'sourcemap', source: 'bun.d.ts', fragment: 'Specifies if and how to generate source maps', docSays: 'sourcemap: none/linked/external/inline', evidencePath: 'scenarios.S04-sourcemap-inline.observed.inlineBase64', kind: 'consistent' },
  { id: 'BC-minify', api: 'minify', source: 'bun.d.ts', fragment: 'Whether to enable minification', docSays: 'minify: boolean or granular object', evidencePath: 'scenarios.S10-minify-on.outputs[0].size', kind: 'consistent' },
  { id: 'BC-conditions', api: 'conditions', source: 'bun.d.ts', fragment: 'conditions used when resolving imports', docSays: 'conditions: package.json exports conditions', evidencePath: 'scenarios.S16b-conditions-custom.observed.resolvedMarker', kind: 'consistent' },
  { id: 'BC-publicPath', api: 'publicPath', source: 'bun.d.ts', fragment: 'publicPath?: string', docSays: 'publicPath: prefix for asset paths', evidencePath: 'scenarios.S17-publicPath.observed.jsReferencesCdn', kind: 'consistent' },
  { id: 'BC-root', api: 'root', source: 'bun.d.ts', fragment: 'root?: string;', docSays: 'root: override project root for output structure', evidencePath: 'scenarios.S18b-root-set.outputs[0].path', kind: 'consistent' },
  { id: 'BC-naming', api: 'naming', source: 'bun.d.ts', fragment: 'asset?: string;', docSays: 'naming: string applies to entrypoints only', evidencePath: 'scenarios.S05a-naming-string.observed.entryPaths', kind: 'consistent' },
  { id: 'BC-external', api: 'external', source: 'bun.d.ts', fragment: 'external?: string[]', docSays: 'external: exclude packages from bundle', evidencePath: 'scenarios.S15a-external-zod.observed.keptImport', kind: 'consistent' },
  { id: 'BC-target', api: 'target', source: 'bun.d.ts', fragment: '@default "browser"', docSays: 'target: browser | bun | node', evidencePath: 'scenarios.S08-target-bun.outputs[0].size', kind: 'consistent' },

  // ---- Bun.Image (findings 5-8) ----
  { id: 'IM-autoOrient', api: 'autoOrient', source: 'bun.d.ts', fragment: 'Apply EXIF Orientation (JPEG) before any other operation.', docSays: 'autoOrient defaults to true (EXIF applied)', evidencePath: 'imageCtorGotchas.autoOrient.exifOrientation6Default', kind: 'consistent' },
  { id: 'IM-maxPixels', api: 'maxPixels', source: 'bun.d.ts', fragment: '268402689', docSays: 'maxPixels default 268402689 (0x3FFF^2, same as Sharp)', evidencePath: 'imageCtorGotchas.maxPixels.typeDocDefault', kind: 'consistent' },
  { id: 'IM-withoutEnlargement', api: 'withoutEnlargement', source: 'bun.d.ts', fragment: 'Never upscale', docSays: 'withoutEnlargement prevents upscaling', evidencePath: 'computeGuideGotchas.withoutEnlargement.withOptionResult', kind: 'consistent' },
  { id: 'IM-progressive', api: 'progressive', source: 'bun.d.ts', fragment: 'Emit a progressive (multi-scan) JPEG', docSays: 'jpeg progressive: true emits multi-scan', evidencePath: 'computeGuideGotchas.progressiveJpeg.progressiveHasSOF2', kind: 'consistent' },
  { id: 'IM-palette', api: 'palette', source: 'bun.d.ts', fragment: 'Quantize to a palette and emit indexed (colour-type 3) PNG', docSays: 'png palette: true emits indexed PNG', evidencePath: 'computeGuideGotchas.palettePng.palette64ColorType', kind: 'consistent' },
  { id: 'IM-invalidState', api: 'ERR_INVALID_STATE', source: 'bun.d.ts', fragment: 'the input ArrayBuffer was transferred between', docSays: 'transferred input -> ERR_INVALID_STATE', evidencePath: 'imageCtorGotchas.bufferGuards.transferredBetweenCtorAndTerminal', kind: 'discrepancy' },
  { id: 'BC-banner', api: 'banner', source: 'bun.d.ts', fragment: 'banner?: string', docSays: 'banner: prepend text to bundled code', evidencePath: 'configGapsGotchas.bannerFooter.bannerAtTop', kind: 'consistent' },
  { id: 'BC-footer', api: 'footer', source: 'bun.d.ts', fragment: 'footer?: string', docSays: 'footer: append text to bundled code', evidencePath: 'configGapsGotchas.bannerFooter.footerAtEnd', kind: 'consistent' },
  { id: 'BC-throw', api: 'throw', source: 'bun.d.ts', fragment: 'throw?: boolean', docSays: 'throw:false returns { success:false } instead of rejecting', evidencePath: 'configGapsGotchas.throwOption.throwFalseReturnsSuccessFalse', kind: 'consistent' },
  { id: 'BC-packages', api: 'packages', source: 'bun.d.ts', fragment: 'packages?: "bundle" | "external"', docSays: 'packages: external leaves package imports external', evidencePath: 'configGapsGotchas.packagesExternal.importKept', kind: 'consistent' },
  { id: 'BC-features', api: 'features', source: 'bun.d.ts', fragment: 'features?: string[]', docSays: 'features: bun:bundle feature() dead-code elimination', evidencePath: 'configGapsGotchas.features.withFlag_keepsA', kind: 'consistent' },
  { id: 'BC-tsconfig', api: 'tsconfig', source: 'bun.d.ts', fragment: 'tsconfig?: string', docSays: 'tsconfig: custom tsconfig for path resolution', evidencePath: 'configGapsGotchas.tsconfigPaths.prefixedAliasResolves', kind: 'consistent' },
  { id: 'BC-jsx', api: 'jsx', source: 'bun.d.ts', fragment: 'jsx?: {', docSays: 'jsx: classic factory / automatic runtime transform', evidencePath: 'configGapsGotchas.jsxClassic.factoryHonored', kind: 'consistent' },
  { id: 'BC-ignoreDCEAnnotations', api: 'ignoreDCEAnnotations', source: 'bun.d.ts', fragment: 'Ignore dead code elimination', docSays: 'ignoreDCEAnnotations keeps @__PURE__ calls', evidencePath: 'configGapsGotchas.dceAnnotations.keptWithIgnoreDCEAnnotations', kind: 'consistent' },
  { id: 'BC-emitDCEAnnotations', api: 'emitDCEAnnotations', source: 'bun.d.ts', fragment: 'Force emitting @__PURE__', docSays: 'emitDCEAnnotations forces @__PURE__ marks under whitespace minify', evidencePath: 'configGapsGotchas.dceAnnotations.pureMarkEmittedWithEmitFlag', kind: 'consistent' },
  { id: 'BC-optimizeImports', api: 'optimizeImports', source: 'bun.d.ts', fragment: 'optimizeImports?: string[]', docSays: 'optimizeImports: skip unused barrel re-exports', evidencePath: 'configGapsGotchas.optimizeImports.accepted', kind: 'consistent' },
];

/** APIs with grounded evidence but no ledger row (fit/filter/quality/... come from the probe gates). */
export const EXTRA_GROUNDED: string[] = [
  'fit', 'filter', 'quality', 'lossless', 'compressionLevel', 'colors', 'dither',
  'brightness', 'saturation', 'placeholder', 'blob', 'bytes', 'buffer', 'text',
  'arrayBuffer', 'stream', 'json', 'slice', 'write', 'cwd', 'entrypoints', 'outdir',
  'format', 'splitting', 'loader', 'metafile', 'treeShaking', 'plugins',
];

export function checkClaim(claim: LedgerClaim, sourceText: string, ev: Evidence): CheckResult {
  const docFound = sourceText.includes(claim.fragment);
  const observed = resolvePath(ev, claim.evidencePath);
  let verdict: Verdict;
  if (!docFound) verdict = 'DOC-CHANGED';
  else if (observed === undefined) verdict = 'NO-EVIDENCE';
  else verdict = claim.kind === 'discrepancy' ? 'PINNED-DISCREPANCY' : 'CONSISTENT';
  return { claim, verdict, docFound, observed };
}

export interface CoverageGap {
  surface: string;
  declared: string[];
  covered: string[];
  gaps: string[];
}

export function coverageGaps(declared: Record<string, string[]>, coveredNames: Set<string>): CoverageGap[] {
  return Object.entries(declared).map(([surface, names]) => {
    const gaps = names.filter((n) => !coveredNames.has(n));
    return { surface, declared: names, covered: names.filter((n) => coveredNames.has(n)), gaps };
  }).filter((g) => g.gaps.length > 0);
}

export {};