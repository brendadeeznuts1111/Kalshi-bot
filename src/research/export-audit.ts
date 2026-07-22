// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildAuditEvidenceWire,
  buildAuditRunExport,
  evidenceExportPath,
  evidenceFileBody,
  type AuditConceptWire,
  type AuditFindingWire,
} from "./audit-adapter.ts";
import type { ResearchConfig, ResearchRun } from "./types.ts";
import {
  decodeEvidenceBody,
  digestLogicalEvidenceBody,
  digestStoredEvidenceBytes,
  encodeEvidenceBody,
  evidenceStorageLabel,
} from "./evidence-io.ts";
import { validateRepoReport } from "./validate.ts";
import { AUDIT_EVIDENCE_DIR, AUDIT_EXPORT_DIR, auditEvidenceAbsPath, joinPath, ROOT } from "./paths.ts";

function findingFileName(finding: AuditFindingWire): string {
  return `${finding.id}.finding.json`;
}

export async function writeAuditExports(
  run: ResearchRun,
  config: ResearchConfig,
  options?: { repo?: string },
): Promise<string | null> {
  const exp = buildAuditRunExport(run, config, options);
  if (!exp.bundles.length) return null;

  const auditDir = joinPath(AUDIT_EXPORT_DIR, run.runId);
  await mkdir(auditDir, { recursive: true });
  await mkdir(AUDIT_EVIDENCE_DIR, { recursive: true });

  await Bun.write(
    join(auditDir, "shortlist-diversity.concept.json"),
    JSON.stringify(exp.concept, null, 2) + "\n",
  );

  const manifest = {
    runId: exp.runId,
    generatedAt: exp.generatedAt,
    emitter: "kalshi-bot-research",
    findings: exp.bundles.map((b) => ({
      id: b.finding.id,
      fullName: b.repoReport.fullName,
      tier: b.finding.meta?.tier ?? "watchlist",
      evidencePath: b.finding.evidence.path,
      digest: b.finding.evidence.digest,
      contentDigest: b.finding.evidence.contentDigest,
      encoding: b.finding.evidence.encoding,
      zstdLevel: b.finding.evidence.zstdLevel,
    })),
  };
  await Bun.write(join(auditDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  for (const bundle of exp.bundles) {
    validateRepoReport(bundle.repoReport);
    const evidenceAbs = auditEvidenceAbsPath(bundle.repoReport.fullName);
    await mkdir(AUDIT_EVIDENCE_DIR, { recursive: true });
    const body = evidenceFileBody(bundle.evidenceNdjson);
    const encoded = encodeEvidenceBody(body);
    const evidence = buildAuditEvidenceWire(body, bundle.finding.evidence.path, encoded);
    bundle.finding.evidence = evidence;
    await Bun.write(evidenceAbs, encoded.bytes);
    if (evidenceStorageLabel(encoded.encoding) === "zstd") {
      console.error(
        `[audit] zstd evidence ${bundle.repoReport.fullName} (${body.length} → ${encoded.bytes.byteLength} bytes, level ${encoded.zstdLevel})`,
      );
    }
    await Bun.write(
      join(auditDir, findingFileName(bundle.finding)),
      JSON.stringify(bundle.finding, null, 2) + "\n",
    );
    const safe = bundle.repoReport.fullName.replace("/", "__");
    await Bun.write(
      join(auditDir, `${safe}.repo-report.json`),
      JSON.stringify(bundle.repoReport, null, 2) + "\n",
    );
  }

  const auditRel = joinPath("research/exports/audit", run.runId);
  await writeRotorIngestBundle(auditRel);
  return auditRel;
}

export async function hashStoredEvidenceFile(absPath: string): Promise<string> {
  const bytes = await Bun.file(absPath).arrayBuffer();
  return digestStoredEvidenceBytes(new Uint8Array(bytes));
}

export async function hashLogicalEvidenceFile(absPath: string): Promise<string> {
  const bytes = await Bun.file(absPath).arrayBuffer();
  return digestLogicalEvidenceBody(decodeEvidenceBody(bytes));
}

/** @deprecated use hashStoredEvidenceFile / hashLogicalEvidenceFile */
export async function hashEvidenceFile(absPath: string): Promise<string> {
  return hashStoredEvidenceFile(absPath);
}

export function toRotorFindingWire(finding: AuditFindingWire): AuditFindingWire {
  return {
    ...finding,
    evidence: {
      ...finding.evidence,
      path: monorepoEvidencePath(finding.evidence.path),
    },
  };
}

/** Monorepo ingest remaps committed Kalshi evidence paths to rotor layout (.ndjson — monorepo gitignores *.jsonl). */
export function monorepoEvidencePath(localPath: string): string {
  const rel = localPath.replace(/^research\/audit-evidence\//, "").replace(/\.jsonl$/, ".ndjson");
  return joinPath("tools/audit-evidence/kalshi", rel);
}

export type RotorIngestWire = {
  version: 1;
  emitter: "kalshi-bot-research";
  runId: string;
  generatedAt: string;
  concept: AuditConceptWire;
  findings: AuditFindingWire[];
  evidenceCopies: Array<{ kalshiBotPath: string; monorepoPath: string }>;
};

export type AuditVerifyResult = { ok: true } | { ok: false; errors: string[] };

export async function verifyLocalAuditExport(auditRelDir: string): Promise<AuditVerifyResult> {
  const errors: string[] = [];
  const auditDir = join(ROOT, auditRelDir);
  const manifestPath = join(auditDir, "manifest.json");
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    return { ok: false, errors: [`missing manifest: ${auditRelDir}/manifest.json`] };
  }

  const manifest = JSON.parse(await manifestFile.text()) as {
    findings: Array<{
      id: string;
      evidencePath: string;
      digest: string;
      contentDigest?: string;
    }>;
  };

  for (const entry of manifest.findings) {
    const findingPath = join(auditDir, `${entry.id}.finding.json`);
    if (!(await Bun.file(findingPath).exists())) {
      errors.push(`missing finding file: ${entry.id}.finding.json`);
      continue;
    }
    const finding = JSON.parse(await Bun.file(findingPath).text()) as AuditFindingWire;
    const evidenceAbs = join(ROOT, finding.evidence.path);
    if (!(await Bun.file(evidenceAbs).exists())) {
      errors.push(`missing evidence: ${finding.evidence.path}`);
      continue;
    }
    const stored = await hashStoredEvidenceFile(evidenceAbs);
    const logical = await hashLogicalEvidenceFile(evidenceAbs);
    const expectedStored = finding.evidence.digest;
    const expectedLogical = finding.evidence.contentDigest ?? finding.evidence.digest;

    if (stored !== expectedStored) {
      errors.push(
        `stored digest mismatch ${finding.evidence.path}: expected ${expectedStored}, got ${stored}`,
      );
    }
    if (logical !== expectedLogical) {
      errors.push(
        `content digest mismatch ${finding.evidence.path}: expected ${expectedLogical}, got ${logical}`,
      );
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export async function buildRotorIngestWire(auditRelDir: string): Promise<RotorIngestWire | null> {
  const auditDir = join(ROOT, auditRelDir);
  const manifestFile = Bun.file(join(auditDir, "manifest.json"));
  if (!(await manifestFile.exists())) return null;

  const manifest = JSON.parse(await manifestFile.text()) as {
    runId: string;
    generatedAt: string;
    findings: Array<{ id: string; evidencePath: string }>;
  };

  const concept = JSON.parse(
    await Bun.file(join(auditDir, "shortlist-diversity.concept.json")).text(),
  ) as AuditConceptWire;

  const findings: AuditFindingWire[] = [];
  const evidenceCopies: RotorIngestWire["evidenceCopies"] = [];

  for (const entry of manifest.findings) {
    const finding = JSON.parse(
      await Bun.file(join(auditDir, `${entry.id}.finding.json`)).text(),
    ) as AuditFindingWire;
    const rotorFinding = toRotorFindingWire(finding);
    findings.push(rotorFinding);
    evidenceCopies.push({
      kalshiBotPath: finding.evidence.path,
      monorepoPath: rotorFinding.evidence.path,
    });
  }

  return {
    version: 1,
    emitter: "kalshi-bot-research",
    runId: manifest.runId,
    generatedAt: manifest.generatedAt,
    concept,
    findings,
    evidenceCopies,
  };
}

export async function writeRotorIngestBundle(auditRelDir: string): Promise<void> {
  const wire = await buildRotorIngestWire(auditRelDir);
  if (!wire) return;
  const auditDir = join(ROOT, auditRelDir);
  await Bun.write(join(auditDir, "rotor-ingest.json"), JSON.stringify(wire, null, 2) + "\n");
}

export { evidenceExportPath };
