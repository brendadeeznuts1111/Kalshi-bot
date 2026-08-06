#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  buildDemoProofArtifact,
  demoProofJson,
  demoProofMarkdown,
  type DemoProofInput,
} from "../src/partner/execution/demo-proof.ts";

const inputArg = process.argv.find((arg) => arg.startsWith("--input="))?.slice(8);
const outputArg = process.argv.find((arg) => arg.startsWith("--output-dir="))?.slice(13);
if (!inputArg) {
  throw new Error("Usage: bun tools/partner-execution-demo-proof.ts --input=<sanitized.json> [--output-dir=<dir>]");
}
if (Bun.env.KALSHI_ENV === "prod" || Bun.env.KALSHI_PROD_ARMED === "1") {
  throw new Error("Demo proof harness refuses production or production-armed environments");
}
const inputPath = resolve(inputArg);
const input = await Bun.file(inputPath).json() as DemoProofInput;
const artifact = buildDemoProofArtifact(input);
const outputDir = resolve(outputArg ?? "artifacts/execution-demo-proof");
await mkdir(outputDir, { recursive: true });
const stem = `execution-demo-proof-${artifact.day}`;
await Promise.all([
  Bun.write(join(outputDir, `${stem}.json`), demoProofJson(artifact)),
  Bun.write(join(outputDir, `${stem}.md`), demoProofMarkdown(artifact)),
]);
console.log(JSON.stringify({
  input: basename(inputPath),
  json: join(outputDir, `${stem}.json`),
  markdown: join(outputDir, `${stem}.md`),
  passed: artifact.passed,
}, null, 2));
if (!artifact.passed) process.exitCode = 2;
