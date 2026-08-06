import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BlocklistEntry {
  name: string;
  range: string;
  level: "fatal" | "warn";
  url: string | null;
  description: string;
  categories: string[];
}

/* ------------------------------------------------------------------ */
/*  Known-malicious blocklist (supply-chain incidents)                 */
/* ------------------------------------------------------------------ */

const BLOCKLIST: BlocklistEntry[] = [
  {
    name: "event-stream",
    range: ">=3.3.6 <4.0.0",
    level: "fatal",
    url: "https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident",
    description: "event-stream 3.3.6 contained a Bitcoin-stealing backdoor via flatmap-stream",
    categories: ["malware", "backdoor"],
  },
  {
    name: "flatmap-stream",
    range: ">=0.1.1 <=0.1.2",
    level: "fatal",
    url: "https://snyk.io/blog/malicious-code-found-in-npm-package-event-stream",
    description: "Dependency injected into event-stream to exfiltrate Bitcoin wallet data",
    categories: ["malware", "backdoor"],
  },
  {
    name: "rc",
    range: ">=1.2.9",
    level: "fatal",
    url: "https://socket.dev/blog/malicious-npm-packages-rc-and-coa",
    description: "Compromised versions of rc that downloaded and executed remote binaries",
    categories: ["malware", "botnet"],
  },
  {
    name: "coa",
    range: ">=2.0.4",
    level: "fatal",
    url: "https://socket.dev/blog/malicious-npm-packages-rc-and-coa",
    description: "Compromised versions of coa that downloaded and executed remote binaries",
    categories: ["malware", "botnet"],
  },
  {
    name: "ua-parser-js",
    range: ">=0.7.29 <0.7.30 || >=0.8.1 <0.8.2 || >=1.0.1 <1.0.2",
    level: "fatal",
    url: "https://github.com/faisalman/ua-parser-js/issues/536",
    description: "Compromised versions shipped cryptominer and password-stealing trojans",
    categories: ["malware", "botnet"],
  },
  {
    name: "colors",
    range: ">=1.4.1",
    level: "warn",
    url: "https://snyk.io/blog/open-source-maintainer-pulls-the-plug-on-npm-packages-colors-and-faker",
    description: "Protestware — intentionally introduced infinite loops and garbage output",
    categories: ["protestware"],
  },
  {
    name: "faker",
    range: ">=6.6.6",
    level: "warn",
    url: "https://snyk.io/blog/open-source-maintainer-pulls-the-plug-on-npm-packages-colors-and-faker",
    description: "Protestware — intentionally introduced infinite loops and garbage output",
    categories: ["protestware"],
  },
  {
    name: "node-ipc",
    range: ">=10.1.1 <=10.1.3 || >=11.1.0 <=11.1.3",
    level: "warn",
    url: "https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability",
    description: "Protestware — overwrote files with anti-war messages (peacenotwar)",
    categories: ["protestware"],
  },
];

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

const PackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  requestedRange: z.string(),
  tarball: z.string(),
});

const AdvisorySchema = z.object({
  level: z.enum(["fatal", "warn"]),
  package: z.string(),
  url: z.string().nullable(),
  description: z.string().nullable(),
});

/* ------------------------------------------------------------------ */
/*  Heuristic: suspicious package patterns                             */
/* ------------------------------------------------------------------ */

function checkHeuristics(pkg: z.infer<typeof PackageSchema>): z.infer<typeof AdvisorySchema> | null {
  // Typosquatting: common packages with single-character diffs
  const suspiciousTypos = [
    "lodashs", "loadsh", "lodsah", "reactt", "reacct", "angluar",
    "expresss", "axiosx", "momentt", "debugg", "is-odd", "is-even",
  ];
  if (suspiciousTypos.includes(pkg.name)) {
    return {
      level: "fatal",
      package: pkg.name,
      url: null,
      description: `Suspicious typosquatting candidate: "${pkg.name}" closely resembles a popular package.`,
    };
  }

  // Single-maintainer packages with high install counts (potential takeover targets)
  // We can't know install counts at scan time, but we can flag unusual patterns

  // Scoped packages that look official but aren't
  if (/^@types\//.test(pkg.name)) {
    // @types packages are generally safe; don't flag
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Core scanner                                                       */
/* ------------------------------------------------------------------ */

export const scanner: Bun.Security.Scanner = {
  version: "1",

  async scan({ packages }) {
    const results: Bun.Security.Advisory[] = [];

    for (const rawPkg of packages) {
      const pkg = PackageSchema.safeParse(rawPkg);
      if (!pkg.success) {
        // Malformed package data — treat as fatal to be safe
        results.push({
          level: "fatal",
          package: String((rawPkg as any)?.name ?? "unknown"),
          url: null,
          description: `Malformed package metadata: ${pkg.error.message}`,
        });
        continue;
      }

      const p = pkg.data;

      // 1. Blocklist check
      for (const entry of BLOCKLIST) {
        if (p.name === entry.name && Bun.semver.satisfies(p.version, entry.range)) {
          results.push({
            level: entry.level,
            package: p.name,
            url: entry.url,
            description: entry.description,
          });
          break; // Don't double-report the same package
        }
      }

      // 2. Heuristic checks
      const heuristic = checkHeuristics(p);
      if (heuristic) {
        results.push(heuristic);
      }
    }

    return results;
  },
};
