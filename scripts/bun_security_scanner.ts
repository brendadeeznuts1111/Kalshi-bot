/**
 * Native Bun 1.4.5+ Security Scanner API (`[install.security] scanner =
 * "./scripts/bun_security_scanner.ts"`).
 *
 * Executes automatically on `bun install`, `bun add`, `bun update`, and `bun pm scan` before any
 * package code is written or executed. Runs offline in ~1 ms with fail-closed supply-chain rules:
 *
 * 1. Enforces HTTPS-only, credential-free tarballs from allowlisted npm registry hosts.
 * 2. Rejects encoded path traversal, non-.tgz extensions, and tarball-vs-package name mismatches.
 * 3. Blocks known-compromised packages/versions and repo-banned legacy packages.
 * 4. Flags Levenshtein distance-1 typosquats against high-value core & scoped packages.
 * 5. Honors optional repo-local `config/security-scanner-policy.json` and fails closed on deprecated
 *    versions recorded in `config/registry-meta.snapshot.json`.
 *
 * Direct CLI inspection: `bun scripts/bun_security_scanner.ts --explain [--json]`
 *
 * @file Scripts/bun_security_scanner.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface BunSecurityPackage {
  readonly name: string;
  readonly version: string;
  readonly requestedRange?: string | undefined;
  readonly tarball?: string | undefined;
}

export interface BunSecurityAdvisory {
  readonly level: "fatal" | "warn";
  readonly package: string;
  readonly url: string | null;
  readonly description: string;
}

export interface BlockedEntry {
  readonly reason: string;
  readonly url: string | null;
}

export interface SecurityScannerPolicy {
  readonly allowedTarballHosts: readonly string[];
  readonly blockedPackages: Readonly<Record<string, BlockedEntry>>;
  readonly blockedVersions: Readonly<Record<string, Readonly<Record<string, BlockedEntry>>>>;
  readonly protectedNames: readonly string[];
  readonly allowedTyposquatExceptions: readonly string[];
  readonly policyFileLoaded: string | null;
  readonly snapshotDeprecatedCount: number;
}

const DEFAULT_ALLOWED_TARBALL_HOSTS = ["registry.npmjs.org"] as const;
const DEFAULT_INTERNAL_SCOPES = ["@sportsdesk-ops/"] as const;

const DEFAULT_PROTECTED_NAMES = [
  "react",
  "react-dom",
  "typescript",
  "marked",
  "qrcode",
  "recharts",
  "lucide-react",
  "cytoscape",
  "cytoscape-elk",
  "elkjs",
  "semver",
  "esbuild",
  "fast-check",
  "vitest",
  "express",
  "axios",
  "lodash",
  "commander",
  "minimatch",
  "quickjs-emscripten",
  "@types/bun",
  "@types/react",
  "@types/react-dom",
  "@types/node",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/ext-apps",
] as const;

const DEFAULT_TYPOSQUAT_EXCEPTIONS = [
  "react-is",
  "preact",
  "reacts",
  "lodash-es",
  "semver-compare",
  "esbuild-wasm",
] as const;

const DEFAULT_BLOCKED_PACKAGES: Readonly<Record<string, BlockedEntry>> = {
  "flatmap-stream": {
    reason: "Known malicious supply-chain package (event-stream incident).",
    url: "https://github.com/advisories/GHSA-mh6f-8j2x-4483",
  },
  "polyfill-io": {
    reason: "Compromised polyfill.io supply-chain package.",
    url: "https://sansec.io/research/polyfill-supply-chain-attack",
  },
  zodd: {
    reason: "Likely typosquat of canonical `zod` package.",
    url: null,
  },
  viite: {
    reason: "Likely typosquat of canonical `vite` package.",
    url: null,
  },
};

const DEFAULT_BLOCKED_VERSIONS: Readonly<Record<string, Readonly<Record<string, BlockedEntry>>>> = {
  "event-stream": {
    "3.3.6": {
      reason: "Compromised release injecting flatmap-stream credential stealer.",
      url: "https://github.com/advisories/GHSA-mh6f-8j2x-4483",
    },
  },
  "ua-parser-js": {
    "0.7.29": {
      reason: "Hijacked release containing cryptominer/password stealer.",
      url: "https://github.com/advisories/GHSA-pjwm-rvh2-c87w",
    },
    "0.8.0": {
      reason: "Hijacked release containing cryptominer/password stealer.",
      url: "https://github.com/advisories/GHSA-pjwm-rvh2-c87w",
    },
    "1.0.0": {
      reason: "Hijacked release containing cryptominer/password stealer.",
      url: "https://github.com/advisories/GHSA-pjwm-rvh2-c87w",
    },
  },
  coa: {
    "2.0.3": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
    "2.0.4": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
    "2.1.1": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
    "2.1.3": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
    "3.0.1": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
    "3.1.3": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-73qr-pfmq-6rp8",
    },
  },
  rc: {
    "1.2.9": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-g2q5-5433-rhrf",
    },
    "1.3.9": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-g2q5-5433-rhrf",
    },
    "2.3.9": {
      reason: "Hijacked release with credential-stealing preinstall.",
      url: "https://github.com/advisories/GHSA-g2q5-5433-rhrf",
    },
  },
  "node-ipc": {
    "10.1.1": {
      reason: "Sabotaged release with destructive protestware payload.",
      url: "https://github.com/advisories/GHSA-97m3-w2cp-4xx6",
    },
    "10.1.2": {
      reason: "Sabotaged release with destructive protestware payload.",
      url: "https://github.com/advisories/GHSA-97m3-w2cp-4xx6",
    },
    "10.1.3": {
      reason: "Sabotaged release with destructive protestware payload.",
      url: "https://github.com/advisories/GHSA-97m3-w2cp-4xx6",
    },
  },
  colors: {
    "1.4.1": {
      reason: "Sabotaged release causing infinite loop DoS.",
      url: "https://snyk.io/blog/open-source-npm-packages-colors-faker/",
    },
    "1.4.2": {
      reason: "Sabotaged release causing infinite loop DoS.",
      url: "https://snyk.io/blog/open-source-npm-packages-colors-faker/",
    },
    "1.4.44-liberty-2": {
      reason: "Sabotaged release causing infinite loop DoS.",
      url: "https://snyk.io/blog/open-source-npm-packages-colors-faker/",
    },
  },
  faker: {
    "6.6.6": {
      reason: "Sabotaged empty release.",
      url: "https://snyk.io/blog/open-source-npm-packages-colors-faker/",
    },
  },
  upgrade: {
    "1.1.0": {
      reason:
        "Abandoned 2013 package banned in SportsDesk repos (accidental `bun add upgrade` guard).",
      url: null,
    },
  },
};

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/** Exact edit-distance-1 check (insert, delete, substitute, or adjacent transposition). */
export function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return false;
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;

  if (lenA === lenB) {
    let diffs = 0;
    let firstDiff = -1;
    for (let i = 0; i < lenA; i += 1) {
      if (a[i] !== b[i]) {
        diffs += 1;
        if (firstDiff === -1) firstDiff = i;
        if (diffs > 2) return false;
      }
    }
    if (diffs === 1) return true;
    // Adjacent character transposition (e.g. "raect" vs "react")
    return (
      diffs === 2 &&
      firstDiff + 1 < lenA &&
      a[firstDiff] === b[firstDiff + 1] &&
      a[firstDiff + 1] === b[firstDiff]
    );
  }

  const [shorter, longer] = lenA < lenB ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else {
      if (skipped) return false;
      skipped = true;
      j += 1;
    }
  }
  return true;
}

/** Detect if an npm package name is a likely typosquat of any protected canonical name. */
export function findTyposquatMatch(
  pkgName: string,
  protectedNames: readonly string[],
  exceptions: ReadonlySet<string>,
): string | null {
  const lower = pkgName.toLowerCase();
  if (exceptions.has(lower)) return null;
  const isScoped = lower.startsWith("@");

  for (const target of protectedNames) {
    const canon = target.toLowerCase();
    if (lower === canon) return null;
  }

  for (const target of protectedNames) {
    const canon = target.toLowerCase();
    if (canon.startsWith("@") !== isScoped) continue;
    if (!isScoped && canon.length < 5) continue;
    if (isEditDistanceOne(lower, canon)) {
      return target;
    }
  }
  return null;
}

/** Verify standard npm registry tarball URL path matches `<pkg>/-/<unscoped>-<version>.tgz`. */
export function validateNpmTarballIdentity(
  pkgName: string,
  version: string,
  parsedUrl: URL,
  rawUrl?: string,
): string | null {
  const rawPath = parsedUrl.pathname;
  const rawCheck = rawUrl ?? parsedUrl.href;
  if (/(?:%2e|%2f|%5c|\/\.\.(?:\/|$))/i.test(rawCheck) || /(?:%2e|%2f|%5c|\.\.)/i.test(rawPath)) {
    return `Tarball path contains disallowed traversal encoding for ${pkgName}@${version}`;
  }
  if (!rawPath.toLowerCase().endsWith(".tgz")) {
    return `Tarball URL does not end with .tgz for ${pkgName}@${version}`;
  }
  const marker = "/-/";
  const markerIdx = rawPath.indexOf(marker);
  if (markerIdx === -1) {
    return `Tarball path missing npm "/-/" segment for ${pkgName}@${version}`;
  }
  const pathPkg = decodeURIComponent(rawPath.slice(1, markerIdx));
  if (pathPkg !== pkgName) {
    return `Tarball path package "${pathPkg}" does not match "${pkgName}"`;
  }
  const filename = decodeURIComponent(rawPath.slice(markerIdx + marker.length));
  const unscoped = pkgName.startsWith("@") ? pkgName.slice(pkgName.indexOf("/") + 1) : pkgName;
  const expectedFilename = `${unscoped}-${version}.tgz`;
  if (filename !== expectedFilename) {
    return `Tarball filename "${filename}" does not match expected "${expectedFilename}"`;
  }
  return null;
}

export function buildDefaultSecurityPolicy(cwd: string = process.cwd()): SecurityScannerPolicy {
  const extraHosts = (process.env.SPORTSDESK_ALLOWED_TARBALL_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const allowedHosts = new Set<string>([...DEFAULT_ALLOWED_TARBALL_HOSTS, ...extraHosts]);
  const blockedPackages: Record<string, BlockedEntry> = { ...DEFAULT_BLOCKED_PACKAGES };
  const blockedVersions: Record<string, Record<string, BlockedEntry>> = {};
  for (const [k, v] of Object.entries(DEFAULT_BLOCKED_VERSIONS)) {
    blockedVersions[k] = { ...v };
  }
  const protectedNames = new Set<string>(DEFAULT_PROTECTED_NAMES);
  const exceptions = new Set<string>(DEFAULT_TYPOSQUAT_EXCEPTIONS);

  let policyFileLoaded: string | null = null;
  const localPolicyPath = resolve(cwd, "config/security-scanner-policy.json");
  if (existsSync(localPolicyPath)) {
    const raw = JSON.parse(readFileSync(localPolicyPath, "utf8")) as unknown;
    if (!isPlainRecord(raw)) {
      throw new Error(`Invalid security scanner policy (expected object): ${localPolicyPath}`);
    }
    policyFileLoaded = "config/security-scanner-policy.json";
    if (Array.isArray(raw.allowedTarballHosts)) {
      for (const h of raw.allowedTarballHosts) {
        if (typeof h === "string" && h.trim()) allowedHosts.add(h.trim().toLowerCase());
      }
    }
    if (Array.isArray(raw.allowedTyposquatExceptions)) {
      for (const ex of raw.allowedTyposquatExceptions) {
        if (typeof ex === "string" && ex.trim()) exceptions.add(ex.trim().toLowerCase());
      }
    }
    if (Array.isArray(raw.protectedNames)) {
      for (const name of raw.protectedNames) {
        if (typeof name === "string" && name.trim()) protectedNames.add(name.trim());
      }
    }
    if (isPlainRecord(raw.blockedPackages)) {
      for (const [pkg, reason] of Object.entries(raw.blockedPackages)) {
        if (typeof reason === "string" && reason.trim()) {
          blockedPackages[pkg] = { reason: reason.trim(), url: null };
        }
      }
    }
    if (isPlainRecord(raw.blockedVersions)) {
      for (const [pkg, verMap] of Object.entries(raw.blockedVersions)) {
        if (!isPlainRecord(verMap)) continue;
        blockedVersions[pkg] ??= {};
        for (const [ver, reason] of Object.entries(verMap)) {
          if (typeof reason === "string" && reason.trim()) {
            blockedVersions[pkg]![ver] = { reason: reason.trim(), url: null };
          }
        }
      }
    }
  }

  let snapshotDeprecatedCount = 0;
  const snapPath = resolve(cwd, "config/registry-meta.snapshot.json");
  if (existsSync(snapPath)) {
    try {
      const snap = JSON.parse(readFileSync(snapPath, "utf8")) as unknown;
      if (isPlainRecord(snap) && Array.isArray(snap.dependencies)) {
        for (const dep of snap.dependencies) {
          if (
            isPlainRecord(dep) &&
            typeof dep.name === "string" &&
            typeof dep.version === "string" &&
            typeof dep.deprecated === "string" &&
            dep.deprecated.trim()
          ) {
            blockedVersions[dep.name] ??= {};
            blockedVersions[dep.name]![dep.version] = {
              reason: `Deprecated in committed registry snapshot: ${dep.deprecated.trim()}`,
              url: null,
            };
            snapshotDeprecatedCount += 1;
          }
        }
      }
    } catch {
      // Ignore malformed optional snapshot during offline scans; check_pkg --registry-audit validates it strictly.
    }
  }

  return {
    allowedTarballHosts: [...allowedHosts],
    blockedPackages,
    blockedVersions,
    protectedNames: [...protectedNames],
    allowedTyposquatExceptions: [...exceptions],
    policyFileLoaded,
    snapshotDeprecatedCount,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower.endsWith(".localhost")
  );
}

/** Pure, deterministic scanner evaluation for unit tests and live Bun Security Scanner hooks. */
export function evaluateSecurityAdvisories(
  packages: readonly BunSecurityPackage[],
  policy: SecurityScannerPolicy = buildDefaultSecurityPolicy(),
): BunSecurityAdvisory[] {
  const allowedHosts = new Set(policy.allowedTarballHosts.map((h) => h.toLowerCase()));
  const typoExceptions = new Set(policy.allowedTyposquatExceptions.map((e) => e.toLowerCase()));
  const advisories: BunSecurityAdvisory[] = [];

  for (const pkg of packages) {
    const blockedPkg = policy.blockedPackages[pkg.name];
    if (blockedPkg) {
      advisories.push({
        level: "fatal",
        package: pkg.name,
        url: blockedPkg.url,
        description: `Blocked package ${pkg.name}@${pkg.version}: ${blockedPkg.reason}`,
      });
    } else {
      const typoTarget = findTyposquatMatch(pkg.name, policy.protectedNames, typoExceptions);
      if (typoTarget) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Possible typosquat "${pkg.name}" is edit-distance 1 from protected package "${typoTarget}" (add to allowedTyposquatExceptions if legitimate).`,
        });
      }
    }

    const blockedVer = policy.blockedVersions[pkg.name]?.[pkg.version];
    if (blockedVer) {
      advisories.push({
        level: "fatal",
        package: pkg.name,
        url: blockedVer.url,
        description: `Blocked release ${pkg.name}@${pkg.version}: ${blockedVer.reason}`,
      });
    }

    if (typeof pkg.requestedRange === "string" && pkg.requestedRange.trim()) {
      const range = pkg.requestedRange.trim();
      if (/^http:\/\//i.test(range)) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Plaintext HTTP dependency specifier rejected for ${pkg.name}: ${range}`,
        });
      }
      if (/^(?:https?|git\+https?|git\+ssh):\/\/[^/\s@]+:[^/\s@]+@/i.test(range)) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Embedded credentials in dependency specifier rejected for ${pkg.name}.`,
        });
      }
    }

    if (typeof pkg.tarball === "string" && pkg.tarball.trim()) {
      const rawTarball = pkg.tarball.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawTarball);
      } catch {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Malformed tarball URL for ${pkg.name}@${pkg.version}.`,
        });
        continue;
      }

      if (parsedUrl.protocol !== "https:") {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Non-HTTPS tarball protocol (${parsedUrl.protocol}) rejected for ${pkg.name}@${pkg.version}.`,
        });
      }
      if (parsedUrl.username || parsedUrl.password) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Tarball URL contains embedded credentials for ${pkg.name}@${pkg.version}.`,
        });
      }
      const host = parsedUrl.hostname.toLowerCase();
      if (
        host === "registry.npmjs.org" &&
        DEFAULT_INTERNAL_SCOPES.some((scope) => pkg.name.toLowerCase().startsWith(scope))
      ) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Internal scope package "${pkg.name}@${pkg.version}" resolved from public npm registry (dependency confusion guard).`,
        });
      }
      if (isLoopbackHost(host) || !allowedHosts.has(host)) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          url: null,
          description: `Untrusted tarball host "${host}" rejected for ${pkg.name}@${pkg.version} (allowed: ${[...allowedHosts].join(", ")}).`,
        });
      } else {
        const identityIssue = validateNpmTarballIdentity(
          pkg.name,
          pkg.version,
          parsedUrl,
          rawTarball,
        );
        if (identityIssue) {
          advisories.push({
            level: "fatal",
            package: pkg.name,
            url: null,
            description: identityIssue,
          });
        }
      }
    }
  }

  return advisories;
}

export function resolveParentOsvScannerPath(): string | null {
  const envPath = process.env.SPORTSDESK_OSV_SCANNER_PATH?.trim();
  if (envPath && existsSync(envPath)) return resolve(envPath);
  const candidate = resolve(import.meta.dir, "../../security/scanner.ts");
  return existsSync(candidate) ? candidate : null;
}

export function deduplicateSecurityAdvisories(
  advisories: readonly BunSecurityAdvisory[],
): BunSecurityAdvisory[] {
  const seen = new Set<string>();
  const out: BunSecurityAdvisory[] = [];
  for (const adv of advisories) {
    const key = `${adv.level}\0${adv.package.toLowerCase()}\0${adv.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(adv);
  }
  return out;
}

async function runParentOsvScanner(
  packages: readonly BunSecurityPackage[],
  options: { readonly enableOsvNetwork: boolean; readonly cwd?: string },
): Promise<BunSecurityAdvisory[]> {
  const parentPath = resolveParentOsvScannerPath();
  if (!parentPath || process.env.SPORTSDESK_DISABLE_PARENT_SCANNER === "1") {
    return [];
  }
  try {
    const mod = (await import(pathToFileURL(parentPath).href)) as {
      createScanner?: (opts?: {
        readonly env?: Record<string, string | undefined>;
        readonly cwd?: string;
      }) => {
        readonly scan: (input: {
          readonly packages: readonly BunSecurityPackage[];
        }) => Promise<readonly BunSecurityAdvisory[]>;
      };
    };
    if (typeof mod.createScanner !== "function") return [];
    const env: Record<string, string | undefined> = {
      ...process.env,
      BUN_SCANNER_OFFLINE: options.enableOsvNetwork ? "0" : "1",
    };
    const parent = mod.createScanner({ env, ...(options.cwd ? { cwd: options.cwd } : {}) });
    const res = await parent.scan({ packages });
    return Array.isArray(res) ? [...res] : [];
  } catch {
    return [];
  }
}

export const scanner = {
  version: "1" as const,
  async scan({
    packages,
  }: {
    readonly packages: readonly BunSecurityPackage[];
  }): Promise<BunSecurityAdvisory[]> {
    const local = evaluateSecurityAdvisories(packages);
    const parent = await runParentOsvScanner(packages, {
      enableOsvNetwork: process.env.BUN_SCANNER_OSV === "1",
    });
    return deduplicateSecurityAdvisories([...local, ...parent]);
  },
};

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const policy = buildDefaultSecurityPolicy();
  const parentPath = resolveParentOsvScannerPath();
  const summary = {
    scannerVersion: scanner.version,
    allowedTarballHosts: policy.allowedTarballHosts,
    blockedPackages: Object.keys(policy.blockedPackages).length,
    blockedVersionRules: Object.values(policy.blockedVersions).reduce(
      (sum, m) => sum + Object.keys(m).length,
      0,
    ),
    protectedTyposquatNames: policy.protectedNames.length,
    policyFileLoaded: policy.policyFileLoaded,
    snapshotDeprecatedCount: policy.snapshotDeprecatedCount,
    parentOsvScannerLinked: parentPath !== null,
    osvNetworkMode: process.env.BUN_SCANNER_OSV === "1" ? "live" : "offline-only",
  };
  if (argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `Bun Security Scanner v${summary.scannerVersion}: hosts=[${summary.allowedTarballHosts.join(", ")}] blockedPkgs=${summary.blockedPackages} blockedVers=${summary.blockedVersionRules} typosquatProtected=${summary.protectedTyposquatNames} parentOsv=${summary.parentOsvScannerLinked ? summary.osvNetworkMode : "none"} localPolicy=${summary.policyFileLoaded ?? "none"}`,
    );
  }
}
