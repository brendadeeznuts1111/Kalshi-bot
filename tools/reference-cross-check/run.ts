#!/usr/bin/env bun
/**
 * Reference cross-check pipeline (178):
 *   1. locate the pinned bun-types bundle
 *   2. read bun.d.ts + the doc files the ledger pins
 *   3. load tools/build-artifact-evidence.json
 *   4. check every ledger claim (doc fragment + evidence path)
 *   5. coverage sweep: BuildConfig + Image option names declared in the
 *      bundle vs names with evidence
 *   6. write tools/reference-cross-check/report.json + append 9 to
 *      docs/BUN_BUILD_FINDINGS.md
 * Exit 1 on DOC-CHANGED or NO-EVIDENCE (the pin premise moved or the
 * ledger is broken). Discrepancies and coverage gaps are informational.
 */
import { join } from 'node:path';
import { locateBundleRoot, readFile, interfaceFields, interfaceFieldsContaining, classMembers } from './docs-parser.ts';
import { loadEvidence } from './evidence-loader.ts';
import { LEDGER, checkClaim, EXTRA_GROUNDED, coverageGaps, type CheckResult } from './compare.ts';
import { writeJsonReport, renderSection9, appendSection9, type CrossCheckMeta } from './reporter.ts';

const ROOT = join(import.meta.dir, '..', '..');

export async function runCrossCheck(): Promise<number> {
  const bundle = locateBundleRoot(ROOT);
  const dtsPath = join(bundle, 'bun.d.ts');
  const dts = await readFile(dtsPath);
  const mdxPath = join(bundle, 'docs/bundler/index.mdx');
  const mdx = await readFile(mdxPath);
  const serveDts = await readFile(join(bundle, 'serve.d.ts'));
  const sqliteDts = await readFile(join(bundle, 'sqlite.d.ts'));
  const ev = await loadEvidence(join(ROOT, 'tools/build-artifact-evidence.json'));

  // ledger checks
  const checks: CheckResult[] = [];
  for (const claim of LEDGER) {
    const src = claim.source === 'serve.d.ts' ? serveDts : claim.source === 'sqlite.d.ts' ? sqliteDts : claim.source.endsWith('.mdx') ? mdx : dts;
    checks.push(checkClaim(claim, src, ev));
  }

  // coverage sweep: declared option names from the bundle interfaces
  const buildConfigFields = interfaceFields(dts, 'BuildConfig');
  const ctor = interfaceFieldsContaining(dts, ['maxPixels']);
  const resize = interfaceFieldsContaining(dts, ['withoutEnlargement']);
  const modulate = interfaceFieldsContaining(dts, ['greyscale']);
  const encode = interfaceFieldsContaining(dts, ['progressive', 'palette']);
  const covered = new Set<string>([...LEDGER.map((c) => c.api), ...EXTRA_GROUNDED]);
  const declared: Record<string, string[]> = {};
  declared['BuildConfig'] = buildConfigFields;
  if (ctor) declared['Image.' + ctor.name] = ctor.fields;
  if (resize) declared['Image.' + resize.name] = resize.fields;
  if (modulate) declared['Image.' + modulate.name] = modulate.fields;
  if (encode) declared['Image.' + encode.name] = encode.fields;
  declared['Serve.BaseServeOptions'] = interfaceFields(serveDts, 'BaseServeOptions');
  declared['Serve.HostnamePortServeOptions'] = interfaceFields(serveDts, 'HostnamePortServeOptions');
  declared['Serve.UnixServeOptions'] = interfaceFields(serveDts, 'UnixServeOptions');
  declared['bun:sqlite.Database'] = classMembers(sqliteDts, 'Database');
  declared['bun:sqlite.Statement'] = classMembers(sqliteDts, 'Statement');
  const gaps = coverageGaps(declared, covered);

  const meta: CrossCheckMeta = {
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    bundleHash: bundle.split('/').filter((x) => x.startsWith('bun-types@')).pop() ?? 'unknown',
  };

  await writeJsonReport(join(ROOT, 'tools/reference-cross-check/report.json'), checks, gaps, meta);
  const section = renderSection9(checks, gaps, meta);
  const changed = await appendSection9(join(ROOT, 'docs/BUN_BUILD_FINDINGS.md'), section);

  const counts: Record<string, number> = {};
  for (const c of checks) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  const fatal = checks.filter((c) => c.verdict === 'DOC-CHANGED' || c.verdict === 'NO-EVIDENCE');
  console.log('reference-cross-check - ' + checks.length + ' claims · ' + JSON.stringify(counts) + ' · gaps: ' + gaps.length + (changed ? ' · §9 updated' : ' · §9 unchanged'));
  if (fatal.length) {
    console.error('reference-cross-check FAIL: ' + fatal.map((c) => c.claim.id + '=' + c.verdict).join(', '));
    return 1;
  }
  return 0;
}

export {};