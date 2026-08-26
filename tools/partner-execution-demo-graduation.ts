#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { DemoProofArtifact } from '../src/partner/execution/demo-proof.ts';
import {
  demoGraduationJson,
  verifyDemoGraduation,
} from '../src/partner/execution/demo-graduation.ts';

const { values: pdgv } = parseArgs({ args: Bun.argv.slice(2), options: { input: { type: 'string', multiple: true }, 'output-dir': { type: 'string' } }, strict: false, allowPositionals: true });
const inputArgs = (Array.isArray(pdgv.input) ? pdgv.input : typeof pdgv.input === 'string' ? [pdgv.input] : []).map((s) => resolve(String(s)));
const outputArg = typeof pdgv['output-dir'] === 'string' ? pdgv['output-dir'] : undefined;
if (inputArgs.length === 0) {
  throw new Error(
    'Usage: bun tools/partner-execution-demo-graduation.ts --input=<daily-proof.json> (repeat 7 times) [--output-dir=<dir>]'
  );
}
if (Bun.env.KALSHI_ENV === 'prod' || Bun.env.KALSHI_PROD_ARMED === '1') {
  throw new Error('Demo graduation verifier refuses production or production-armed environments');
}
const artifacts = await Promise.all(
  inputArgs.map(async path => (await Bun.file(path).json()) as DemoProofArtifact)
);
const manifest = verifyDemoGraduation(artifacts);
const outputDir = resolve(outputArg ?? 'artifacts/execution-demo-proof');
await mkdir(outputDir, { recursive: true });
const output = join(outputDir, 'execution-demo-graduation.json');
await Bun.write(output, demoGraduationJson(manifest));
console.log(
  JSON.stringify(
    {
      output,
      firstDay: manifest.firstDay,
      lastDay: manifest.lastDay,
      passed: manifest.passed,
      failures: manifest.failures,
    },
    null,
    2
  )
);
if (!manifest.passed) process.exitCode = 2;
