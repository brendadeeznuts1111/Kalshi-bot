import type { RepoCandidate } from "./types.ts";
import { applyGate, gateRejectionReasons, type GateOptions, type GateRejectionReason } from "./gate.ts";

export type GateNearMiss = {
  fullName: string;
  stars: number;
  forks: number;
  pushedAt: string;
  pushedLabel: string;
  reasons: GateRejectionReason[];
  summary: string;
};

export type GateMissStats = {
  rejected: number;
  nearMisses: GateNearMiss[];
  retryCommand: string | null;
  retryHint: string | null;
};

function formatPushedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 7);
}

function formatNearMissSummary(repo: RepoCandidate, gate: GateOptions, reasons: GateRejectionReason[]): string {
  const head = `${repo.stars} stars, ${repo.forks} forks, pushed ${formatPushedLabel(repo.pushedAt)}`;
  const hints: string[] = [];

  if (reasons.includes("archived")) hints.push("archived");
  if (reasons.includes("low_popularity")) {
    const meetsStars = repo.stars >= gate.minStars;
    const meetsForks = repo.forks >= gate.minForks;
    if (!meetsStars && !meetsForks) {
      hints.push(`needs ${gate.minStars} stars or ${gate.minForks} forks`);
    } else if (!meetsStars) {
      hints.push(`${gate.minStars - repo.stars} star(s) below min-stars=${gate.minStars}`);
    } else {
      hints.push(`${gate.minForks - repo.forks} fork(s) below min-forks=${gate.minForks}`);
    }
  }
  if (reasons.includes("stale")) {
    hints.push(`pushed before ${gate.maxAgeMonths}-month cutoff`);
  }

  return hints.length ? `${head} — ${hints.join("; ")}` : head;
}

/** Higher = closer to passing (archived repos sink to bottom). */
export function nearMissScore(repo: RepoCandidate, gate: GateOptions): number {
  const reasons = gateRejectionReasons(repo, gate);
  if (!reasons.length) return 1000;
  if (reasons.includes("archived")) return -1;

  let score = 0;
  if (!reasons.includes("low_popularity")) score += 50;
  if (!reasons.includes("stale")) score += 50;

  const starRatio = gate.minStars > 0 ? repo.stars / gate.minStars : 1;
  const forkRatio = gate.minForks > 0 ? repo.forks / gate.minForks : 1;
  score += Math.max(starRatio, forkRatio) * 40;

  if (reasons.includes("stale") && !reasons.includes("low_popularity")) {
    const pushed = new Date(repo.pushedAt).getTime();
    if (Number.isFinite(pushed)) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - gate.maxAgeMonths);
      const agePastCutoffMs = cutoff.getTime() - pushed;
      if (agePastCutoffMs > 0) {
        score += Math.max(0, 20 - agePastCutoffMs / (30 * 86_400_000));
      }
    }
  }

  return score;
}

export function rankGateNearMisses(
  candidates: RepoCandidate[],
  gate: GateOptions,
  limit = 3,
): GateNearMiss[] {
  const gatedSet = new Set(applyGate(candidates, gate).map((r) => r.fullName));
  return candidates
    .filter((repo) => !gatedSet.has(repo.fullName))
    .map((repo) => {
      const reasons = gateRejectionReasons(repo, gate);
      return {
        repo,
        reasons,
        score: nearMissScore(repo, gate),
      };
    })
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ repo, reasons }) => ({
      fullName: repo.fullName,
      stars: repo.stars,
      forks: repo.forks,
      pushedAt: repo.pushedAt,
      pushedLabel: formatPushedLabel(repo.pushedAt),
      reasons,
      summary: formatNearMissSummary(repo, gate, reasons),
    }));
}

export function buildGateRetryCommand(
  gate: GateOptions,
  nearMisses: GateNearMiss[],
  dimension?: string,
): { retryCommand: string | null; retryHint: string | null } {
  if (!nearMisses.length) {
    return {
      retryCommand: null,
      retryHint: "Gate rejected all candidates — try broader discovery queries in research/dimensions.json",
    };
  }

  const best = nearMisses[0]!;
  let minStars = gate.minStars;
  let minForks = gate.minForks;
  let maxAgeMonths = gate.maxAgeMonths;

  if (best.reasons.includes("low_popularity")) {
    const starRatio = gate.minStars > 0 ? best.stars / gate.minStars : 1;
    const forkRatio = gate.minForks > 0 ? best.forks / gate.minForks : 1;
    if (best.stars < gate.minStars && best.forks < gate.minForks) {
      if (starRatio >= forkRatio) minStars = Math.max(1, best.stars);
      else minForks = Math.max(0, best.forks);
    } else if (best.stars < gate.minStars) {
      minStars = Math.max(1, best.stars);
    } else if (best.forks < gate.minForks) {
      minForks = Math.max(0, best.forks);
    }
  }

  if (best.reasons.includes("stale") && !best.reasons.includes("low_popularity")) {
    const pushed = new Date(best.pushedAt);
    if (!Number.isNaN(pushed.getTime())) {
      const ageMonths = Math.ceil((Date.now() - pushed.getTime()) / (30 * 86_400_000));
      maxAgeMonths = Math.max(gate.maxAgeMonths, ageMonths + 1);
    }
  }

  const changed =
    minStars !== gate.minStars || minForks !== gate.minForks || maxAgeMonths !== gate.maxAgeMonths;
  if (!changed) {
    return {
      retryCommand: null,
      retryHint: `Gate miss on ${best.fullName} — adjust gate manually (archived or unrecoverable)`,
    };
  }

  const args = [`--dimension=${dimension ?? "all"}`];
  if (minStars !== gate.minStars) args.push(`--min-stars=${minStars}`);
  if (minForks !== gate.minForks) args.push(`--min-forks=${minForks}`);
  if (maxAgeMonths !== gate.maxAgeMonths) args.push(`--max-age-months=${maxAgeMonths}`);

  const retryCommand = `bun run research -- ${args.join(" ")}`;
  return {
    retryCommand,
    retryHint: `Gate probe: \`${retryCommand}\` (near miss: ${best.fullName} — ${best.summary})`,
  };
}

/** When discover > 0 but none pass gate — ranked near misses + one-click retry. */
export function analyzeGateMiss(
  candidates: RepoCandidate[],
  gated: RepoCandidate[],
  gate: GateOptions,
  context?: { dimension?: string; maxNearMisses?: number },
): GateMissStats | undefined {
  if (!candidates.length || gated.length > 0) return undefined;

  const nearMisses = rankGateNearMisses(candidates, gate, context?.maxNearMisses ?? 3);
  const { retryCommand, retryHint } = buildGateRetryCommand(gate, nearMisses, context?.dimension);

  return {
    rejected: candidates.length,
    nearMisses,
    retryCommand,
    retryHint,
  };
}

export function formatGateMissMarkdown(gateMiss: GateMissStats, gate: GateOptions): string[] {
  const lines: string[] = [
    "## Gate miss",
    "",
    `Discovered **${gateMiss.rejected}** repo(s); **0** passed gate ` +
      `(min-stars=${gate.minStars}, min-forks=${gate.minForks}, max-age-months=${gate.maxAgeMonths}).`,
    "",
  ];

  if (gateMiss.nearMisses.length) {
    lines.push("### Near misses", "");
    gateMiss.nearMisses.forEach((nm, i) => {
      lines.push(`${i + 1}. **${nm.fullName}** — ${nm.summary}`);
    });
    lines.push("");
  }

  if (gateMiss.retryCommand) {
    lines.push("### Suggested probe", "", "```bash", gateMiss.retryCommand, "```", "");
  } else if (gateMiss.retryHint) {
    lines.push(`> ${gateMiss.retryHint}`, "");
  }

  return lines;
}

export type FormatGateMissHtmlOptions = {
  panelId?: string;
  escapeHtml?: (value: string) => string;
};

/** HTML for gate miss panel (reports use {@link formatGateMissMarkdown}). */
export function formatGateMissHtml(
  gateMiss: GateMissStats,
  gate: GateOptions,
  options: FormatGateMissHtmlOptions = {},
): string {
  const esc = options.escapeHtml ?? ((value: string) => value);
  const panelId = options.panelId ?? "gate-miss-panel";

  const nearMissItems = gateMiss.nearMisses
    .map(
      (nm) =>
        `<li><strong>${esc(nm.fullName)}</strong> — ${esc(nm.summary)} ` +
        `(${nm.stars}★ · ${nm.forks} forks · pushed ${esc(nm.pushedLabel)})</li>`,
    )
    .join("\n");

  const probeBlock = gateMiss.retryCommand
    ? `<p><strong>Suggested probe</strong></p>` +
      `<pre><code>${esc(gateMiss.retryCommand)}</code></pre>`
    : gateMiss.retryHint
      ? `<p><em>${esc(gateMiss.retryHint)}</em></p>`
      : "";

  return `<div class="gate-miss" id="${esc(panelId)}">
    <h2>Gate miss</h2>
    <p>Discovered <strong>${gateMiss.rejected}</strong> repo(s); <strong>0</strong> passed gate ` +
    `(min-stars=${gate.minStars}, min-forks=${gate.minForks}, max-age-months=${gate.maxAgeMonths}).</p>
    ${nearMissItems ? `<h3>Near misses</h3><ol>${nearMissItems}</ol>` : ""}
    ${probeBlock}
  </div>`;
}
