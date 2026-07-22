import type { ResearchRun, ScoredRepo } from "../research/types.ts";
import type { ScoreComponentKey } from "../research/constants.ts";
import { SCORE_COMPONENTS, COMPONENT_WEIGHTS } from "../research/constants.ts";
import { loadLatestRunFromDb, loadRunFromDb } from "../research/cache.ts";
import { buildRepoReport } from "../research/evidence.ts";
import {
  isHighValueCandidate,
  resolveAuditExportTier,
  type AuditExportTier,
} from "../research/audit-adapter.ts";
import {
  buildRotorVerificationIndex,
  formatVerificationBadge,
  lookupRepoVerification,
  type RotorVerificationContext,
  type VerificationStatus,
} from "./audit-list.ts";

export type LiftRecommendation = {
  component: ScoreComponentKey;
  repo: string;
  points: number;
  maxPoints: number;
  matched: boolean;
  rationale: string;
  auditTier: AuditExportTier | null;
  verified: boolean;
  verification: VerificationStatus;
  findingId: string | null;
};

export type ShortlistSummary = {
  fullName: string;
  total: number;
  auditTier: AuditExportTier | null;
  license: string | null;
  unlicensed: boolean;
  verified: boolean;
  verification: VerificationStatus;
  findingId: string | null;
};

export type SuggestLiftResult = {
  runId: string;
  generatedAt: string;
  recommendations: LiftRecommendation[];
  shortlist: ShortlistSummary[];
  notes: string[];
  rotorCatalogAvailable: boolean;
  pulseOk: boolean | null;
};

function componentPoints(item: ScoredRepo, component: ScoreComponentKey): number {
  return item.score[component];
}

function componentMax(component: ScoreComponentKey): number {
  return COMPONENT_WEIGHTS[component];
}

function detectorFor(item: ScoredRepo, component: ScoreComponentKey) {
  const report = item.report ?? buildRepoReport(item);
  return report.detectors.find((d) => d.component === component);
}

function bestForComponent(
  shortlist: ScoredRepo[],
  component: ScoreComponentKey,
  generatedAt: string,
  rotor?: RotorVerificationContext,
): LiftRecommendation {
  let best: ScoredRepo | null = null;
  let bestPoints = -1;

  for (const item of shortlist) {
    const pts = componentPoints(item, component);
    if (pts > bestPoints) {
      best = item;
      bestPoints = pts;
    }
  }

  if (!best) {
    return {
      component,
      repo: "",
      points: 0,
      maxPoints: componentMax(component),
      matched: false,
      rationale: "No shortlist candidates",
      auditTier: null,
      verified: false,
      verification: "unverified",
      findingId: null,
    };
  }

  const report = best.report ?? buildRepoReport(best, generatedAt);
  const detector = detectorFor(best, component);
  const auditTier = resolveAuditExportTier(report);
  const rotorStatus = lookupRepoVerification(rotor, best.repo.fullName);
  return {
    component,
    repo: best.repo.fullName,
    points: bestPoints,
    maxPoints: componentMax(component),
    matched: detector?.matched ?? false,
    rationale: detector?.rationale ?? "No detector rationale",
    auditTier,
    verified: rotorStatus.verified,
    verification: rotorStatus.verification,
    findingId: rotorStatus.findingId,
  };
}

export function suggestLiftFromRun(
  run: ResearchRun,
  rotor?: RotorVerificationContext,
): SuggestLiftResult {
  const shortlist = run.shortlist;
  const notes: string[] = [];

  const auditReady = shortlist.filter((item) => {
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    return isHighValueCandidate(report);
  });

  const watchlistReady = shortlist.filter((item) => {
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    return resolveAuditExportTier(report) === "watchlist";
  });

  if (auditReady.length === 0) {
    notes.push(
      "No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).",
    );
  } else if (auditReady.length === 1) {
    notes.push(`Primary high-value audit export: ${auditReady[0]!.repo.fullName}.`);
  } else {
    notes.push(`${auditReady.length} repos qualify for high-value audit export.`);
  }

  if (watchlistReady.length) {
    notes.push(
      `Watchlist tier (${watchlistReady.length}): ${watchlistReady.map((s) => s.repo.fullName).join(", ")} — auditable at ≥65/≥12, status open.`,
    );
  }

  if (rotor?.warning) {
    notes.push(rotor.warning);
  } else if (rotor?.catalogAvailable && rotor.pulseOk === false) {
    notes.push("Rotor pulse last tick failed — high-value findings not pulse-verified.");
  } else if (rotor?.catalogAvailable && rotor.pulseOk === true) {
    const verifiedCount = [...rotor.byRepo.values()].filter((v) => v.verified).length;
    if (verifiedCount) {
      notes.push(`Rotor catalog: ${verifiedCount} pulse-verified finding(s) on shortlist.`);
    }
  }

  const unlicensed = shortlist.filter((s) => s.repo.license.unlicensed);
  if (unlicensed.length) {
    notes.push(
      `License warning: ${unlicensed.map((s) => s.repo.fullName).join(", ")} lack usable OSS license.`,
    );
  }

  const recommendations = SCORE_COMPONENTS.map((component) =>
    bestForComponent(shortlist, component, run.generatedAt, rotor),
  );

  const uniqueRepos = new Set(recommendations.map((r) => r.repo).filter(Boolean));
  if (uniqueRepos.size > 1) {
    notes.push(
      "Composite bot: lift modules per component from different repos (see recommendations map).",
    );
  }

  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    recommendations,
    shortlist: shortlist.map((item) => {
      const report = item.report ?? buildRepoReport(item, run.generatedAt);
      const auditTier = resolveAuditExportTier(report);
      const rotorStatus = lookupRepoVerification(rotor, item.repo.fullName);
      return {
        fullName: item.repo.fullName,
        total: item.score.total,
        auditTier,
        license: item.repo.license.spdxId ?? item.repo.license.name,
        unlicensed: item.repo.license.unlicensed,
        verified: rotorStatus.verified,
        verification: rotorStatus.verification,
        findingId: rotorStatus.findingId,
      };
    }),
    notes,
    rotorCatalogAvailable: rotor?.catalogAvailable ?? false,
    pulseOk: rotor?.pulseOk ?? null,
  };
}

export async function suggestLiftWithRotor(run: ResearchRun): Promise<SuggestLiftResult> {
  const rotor = await buildRotorVerificationIndex();
  return suggestLiftFromRun(run, rotor);
}

export function loadRunForSuggest(runId?: string): ResearchRun | null {
  if (runId?.trim()) return loadRunFromDb(runId.trim());
  return loadLatestRunFromDb();
}

export function formatSuggestLift(result: SuggestLiftResult): string {
  const header =
    result.rotorCatalogAvailable && result.pulseOk !== false
      ? "Lift map (rotor-aware):"
      : "Lift map:";
  const lines: string[] = [
    `Lift suggestions — run ${result.runId} (${result.generatedAt})`,
    "",
    header,
  ];

  for (const rec of result.recommendations) {
    const badge =
      rec.repo !== ""
        ? ` ${formatVerificationBadge({
            verified: rec.verified,
            verification: rec.verification,
            auditTier: rec.auditTier,
          })}`
        : "";
    lines.push(
      `  ${rec.component.padEnd(14)} ← ${rec.repo || "—"} (${rec.points}/${rec.maxPoints})${badge}`,
    );
    lines.push(`    ${rec.rationale}`);
  }

  lines.push("", "Shortlist:");
  for (const s of result.shortlist) {
    const lic = s.unlicensed ? " UNLICENSED" : "";
    const badge = formatVerificationBadge({
      verified: s.verified,
      verification: s.verification,
      auditTier: s.auditTier,
    });
    lines.push(`  ${s.fullName} — ${s.total} — ${badge}${lic}`);
  }

  if (result.notes.length) {
    lines.push("", "Notes:");
    for (const n of result.notes) lines.push(`  • ${n}`);
  }

  return lines.join("\n");
}
