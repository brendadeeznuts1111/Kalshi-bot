#!/usr/bin/env bun
/**
 * Miss taxonomy proof/status — lane checklist with symbol probes.
 * @see docs/MISS_TAXONOMY.md
 */
import { joinPath } from "../src/research/paths.ts";

type LaneStatus = "done" | "pending" | "blocked";

type Lane = {
  id: string;
  name: string;
  owner: string;
  status: LaneStatus;
  proof: string[];
  probes: Array<{ label: string; path: string; pattern: RegExp }>;
};

const ROOT = joinPath(import.meta.dir, "..");

async function fileExists(rel: string): Promise<boolean> {
  return Bun.file(joinPath(ROOT, rel)).exists();
}

async function probeMatch(rel: string, pattern: RegExp): Promise<boolean> {
  const file = Bun.file(joinPath(ROOT, rel));
  if (!(await file.exists())) return false;
  return pattern.test(await file.text());
}

const LANES: Lane[] = [
  {
    id: "1",
    name: "Gate miss",
    owner: "core",
    status: "done",
    proof: ["tests/gate-miss.test.ts"],
    probes: [
      { label: "analyzeGateMiss", path: "src/research/gate-miss.ts", pattern: /export function analyzeGateMiss/ },
      { label: "gateMiss on run", path: "src/research/types.ts", pattern: /gateMiss\?/ },
    ],
  },
  {
    id: "2",
    name: "Pattern miss",
    owner: "core",
    status: "done",
    proof: ["tests/pattern-miss.test.ts"],
    probes: [
      { label: "patternMissSuggestions", path: "src/agent/pattern-miss.ts", pattern: /export function patternMissSuggestions/ },
      { label: "patternMiss field", path: "src/agent/pattern-extract.ts", pattern: /patternMiss/ },
    ],
  },
  {
    id: "8",
    name: "Rate-limit budget miss",
    owner: "core",
    status: "done",
    proof: ["tests/github-rate-limit.test.ts"],
    probes: [
      { label: "evaluateInspectRateBudget", path: "src/research/github-rate-limit.ts", pattern: /export function evaluateInspectRateBudget/ },
      { label: "code_search resource", path: "src/research/gh.ts", pattern: /code_search/ },
    ],
  },
  {
    id: "3",
    name: "Cross-dimension cache fallback",
    owner: "A",
    status: "pending",
    proof: ["tests/github-errors.test.ts"],
    probes: [
      { label: "loadFallbackRunFromDb", path: "src/research/cache.ts", pattern: /export function loadFallbackRunFromDb/ },
      { label: "staleDataSourceDimension", path: "src/research/github-errors.ts", pattern: /staleDataSourceDimension/ },
    ],
  },
  {
    id: "4",
    name: "Staleness badges",
    owner: "B",
    status: "pending",
    proof: ["tests/staleness-badge.test.ts"],
    probes: [
      { label: "freshness suffix", path: "src/agent/audit-list.ts", pattern: /formatDataFreshnessSuffix|🕒/ },
      { label: "staleness test", path: "tests/staleness-badge.test.ts", pattern: /describe\(/ },
    ],
  },
  {
    id: "5",
    name: "Discovery miss",
    owner: "C",
    status: "pending",
    proof: ["tests/discovery-miss.test.ts"],
    probes: [
      { label: "analyzeDiscoveryMiss", path: "src/research/discovery-miss.ts", pattern: /export function analyzeDiscoveryMiss/ },
      { label: "discoveryMiss on run", path: "src/research/types.ts", pattern: /discoveryMiss\?/ },
    ],
  },
  {
    id: "D",
    name: "Price-data research fill",
    owner: "D",
    status: "blocked",
    proof: ["bun run rate-limit:status"],
    probes: [
      { label: "price-data dimension", path: "research/dimensions.json", pattern: /price-data/ },
    ],
  },
];

async function resolveLaneStatus(lane: Lane): Promise<LaneStatus> {
  if (lane.status === "blocked") return "blocked";
  const probeHits = await Promise.all(lane.probes.map((p) => probeMatch(p.path, p.pattern)));
  const proofHits = await Promise.all(lane.proof.map((p) => fileExists(p)));
  const allProbes = probeHits.every(Boolean);
  const allProof = proofHits.every(Boolean);
  if (allProbes && allProof) return "done";
  return "pending";
}

function statusIcon(status: LaneStatus): string {
  if (status === "done") return "✓";
  if (status === "blocked") return "⏸";
  return "○";
}

const strict = process.argv.includes("--strict");

console.log("Miss taxonomy status\n");

let pending = 0;
let blocked = 0;

for (const lane of LANES) {
  const status = await resolveLaneStatus(lane);
  if (status === "pending") pending++;
  if (status === "blocked") blocked++;

  console.log(`${statusIcon(status)} #${lane.id} ${lane.name} [lane ${lane.owner}] — ${status}`);
  for (const p of lane.probes) {
    const hit = await probeMatch(p.path, p.pattern);
    console.log(`    ${hit ? "✓" : "·"} probe: ${p.label} (${p.path})`);
  }
  for (const proof of lane.proof) {
    const hit = await fileExists(proof);
    console.log(`    ${hit ? "✓" : "·"} proof: ${proof}`);
  }
  console.log("");
}

console.log(`Summary: ${LANES.length - pending - blocked} done, ${pending} pending, ${blocked} blocked`);
console.log("Proof gate: bun run check");

if (strict && pending > 0) {
  console.error("\nStrict mode: pending lanes remain.");
  process.exit(1);
}
