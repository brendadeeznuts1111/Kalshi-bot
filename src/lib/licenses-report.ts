/**
 * licenses-report — pure markdown renderer for the license-compliance
 * report artifact (§103). Feeds on the gate's --json output (plus a
 * config fingerprint) and renders a static, auditable document for
 * legal / release sign-off. No Bun APIs — unit-testable anywhere.
 */

export interface ReportPackage {
  name: string;
  version: string;
  reportedLicense: string;
  normalizedLicense: string;
  allowed: boolean;
  matchedBy: string | null;
  fingerprint: string;
  reason?: string;
  expires?: string;
  expiresInDays?: number;
}

export interface LicensesReportInput {
  ok: boolean;
  /** Content-addressed CycloneDX serial of the XML twin (when emitted). */
  xmlSerial?: string;
  generatedAt: string;
  bunVersion: string;
  summary: { total: number; allowed: number; violations: number; exemptions: number };
  packages: ReportPackage[];
  violations: { name: string; version: string; license: string; reason?: string }[];
  advisories: { name: string; version: string; severity: string; note: string }[];
  expiringSoon: { name: string; version: string; expires: string; expiresInDays: number; reason: string }[];
  staleExemptions: string[];
  diff: { added: string[]; removed: string[]; changed: string[] } | null;
  configSha: string;
}

function statusOf(p: ReportPackage): string {
  if (p.matchedBy === "exemption") return "exemption" + (p.expires ? " (expires " + p.expires + ")" : "");
  if (p.matchedBy === "expression") return "expression";
  if (p.matchedBy === "allowlist") return "allowlist";
  return "FAIL";
}

export function renderLicensesReport(input: LicensesReportInput): string {
  const rows: string[] = [];
  const push = (s = "") => rows.push(s);
  push("# License Compliance Report");
  push();
  push("- Generated: " + input.generatedAt);
  push("- Bun: " + input.bunVersion);
  push("- Config fingerprint: " + input.configSha + " (licenses-allowlist.json + audit-overrides.json)");
  push("- Gate status: **" + (input.ok ? "PASS" : "FAIL") + "**");
  if (input.xmlSerial) push("- XML SBOM serial: " + input.xmlSerial + " (licenses-sbom.xml)");
  push();
  push("## Summary");
  push();
  push("| Total | Allowed | Exemptions | Violations | Advisories | Expiring soon |");
  push("|---|---|---|---|---|---|");
  push("| " + [input.summary.total, input.summary.allowed, input.summary.exemptions, input.summary.violations, input.advisories.length, input.expiringSoon.length].join(" | ") + " |");
  push();
  push("## Packages");
  push();
  push("| Package | Version | License | Status | Fingerprint |");
  push("|---|---|---|---|---|");
  for (const p of input.packages) push("| " + [p.name, p.version, p.reportedLicense, statusOf(p), p.fingerprint].join(" | ") + " |");
  push();
  const exempt = input.packages.filter((p) => p.matchedBy === "exemption");
  push("## Exemptions");
  push();
  if (exempt.length === 0) {
    push("- none");
  } else {
    for (const p of exempt) {
      push("- " + p.name + "@" + p.version + " (" + p.reportedLicense + ")" + (p.expires ? " expires " + p.expires + (p.expiresInDays !== undefined ? " (in " + p.expiresInDays + " days)" : "") : "") + (p.reason ? " — " + p.reason : ""));
    }
  }
  push();
  push("## Advisories (warn-only)");
  push();
  if (input.advisories.length === 0) {
    push("- none");
  } else {
    for (const a of input.advisories) push("- " + a.name + "@" + a.version + " (" + a.severity + ")" + (a.note ? " — " + a.note : ""));
  }
  push();
  push("## Expiring soon");
  push();
  if (input.expiringSoon.length === 0) {
    push("- none");
  } else {
    for (const e of input.expiringSoon) push("- " + e.name + "@" + e.version + " expires " + e.expires + " (in " + e.expiresInDays + " days)");
  }
  push();
  push("## Drift vs previous snapshot");
  push();
  if (input.diff === null) {
    push("- no snapshot comparison");
  } else if (input.diff.added.length + input.diff.removed.length + input.diff.changed.length === 0) {
    push("- no dependency drift");
  } else {
    for (const a of input.diff.added) push("- + added " + a);
    for (const r of input.diff.removed) push("- - removed " + r);
    for (const c of input.diff.changed) push("- ~ changed " + c);
  }
  push();
  push("## Violations");
  push();
  if (input.violations.length === 0) {
    push("- none");
  } else {
    for (const v of input.violations) push("- FAIL " + v.name + "@" + v.version + " (" + v.license + ")" + (v.reason ? " — " + v.reason : ""));
  }
  if (input.staleExemptions.length > 0) {
    push();
    push("## Stale exemptions (match no package)");
    push();
    for (const s of input.staleExemptions) push("- " + s);
  }
  return rows.join("\n") + "\n";
}

/**
 * Content-addressed CycloneDX serial (§105): sha256 of a seed, formatted
 * as a UUID (8-4-4-4-12). Identical content -> identical serial, so a
 * reviewer can verify the BOM matches exactly the policy + dependency
 * set that produced it; any change -> a new serial. Pure (no crypto lib
 * dependency — caller supplies the hex).
 */
export function deterministicSerial(hex32: string): string {
  const h = (hex32 ?? "").padEnd(32, "0").slice(0, 32);
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
}

/**
 * CycloneDX 1.5 XML body (§104) as a COMPACT object for Bun.XML.stringify
 * (the verified XML API — see xml:probe §68). The CLI prepends the XML
 * prolog and writes research/outputs/licenses-sbom.xml alongside the
 * markdown report — the machine-readable twin for SBOM-ingesting
 * pipelines. Namespace prefixes are kept verbatim by the runtime; the
 * CycloneDX default-namespace elements need no prefix.
 */
export function buildCycloneDxObject(input: LicensesReportInput, serialNumber: string): unknown {
  const components = input.packages.map((p) => ({
    "@type": "library",
    "@bom-ref": "pkg:generic/" + p.name + "@" + p.version,
    name: p.name,
    version: p.version,
    licenses: { license: /^[A-Za-z0-9.+-]+$/.test(p.reportedLicense) ? { id: p.reportedLicense } : { name: p.reportedLicense } },
    properties: { property: [
      { "@name": "kalshi-bot:status", "#text": statusOf(p) },
      { "@name": "kalshi-bot:allowed", "#text": String(p.allowed) },
    ] },
  }));
  return {
    bom: {
      "@xmlns": "http://cyclonedx.org/schema/bom/1.5",
      "@version": "1",
      "@serialNumber": serialNumber,
      metadata: {
        timestamp: input.generatedAt,
        properties: { property: [
          { "@name": "kalshi-bot:gate-status", "#text": input.ok ? "PASS" : "FAIL" },
          { "@name": "kalshi-bot:config-fingerprint", "#text": input.configSha },
          { "@name": "kalshi-bot:bun", "#text": input.bunVersion },
        ] },
      },
      components: { component: components },
    },
  };
}
